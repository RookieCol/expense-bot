# NestJS Best Practices + Gemini OCR — Design Spec

**Date:** 2026-03-13
**Project:** expense-bot (Telegram climbing gym expense tracker)
**Scope:** Structural refactor, NestJS best practices, AI provider abstraction, Google module consolidation

---

## 1. Goals

1. Apply NestJS best practices: env validation, graceful shutdown, global error handling, remove boilerplate
2. Break up the 500-line `TelegramService` God Object into focused handlers
3. Replace `OpenAiService` with a provider-agnostic `AiService` using Gemini as primary and OpenAI as fallback
4. Consolidate all Google API logic into a single `GoogleModule`
5. Keep only official SDKs (`googleapis`, `@google/generative-ai`, `@langchain/openai`)

**Out of scope:** tests, MCP integration, health checks, additional Zod validation

---

## 2. Architecture Overview

```
src/
├── config/
│   └── config.schema.ts            # Joi env validation schema
├── filters/
│   └── global-exception.filter.ts  # Global @Catch() filter
├── ai/
│   ├── ai.module.ts
│   ├── ai.service.ts               # Iterates connector array, provider-agnostic
│   └── connectors/
│       ├── ai-connector.interface.ts
│       ├── gemini.connector.ts     # Primary: gemini-2.0-flash
│       └── openai.connector.ts    # Fallback: gpt-4o-mini
├── google/
│   ├── google.module.ts            # Exports SheetsService + DriveService
│   ├── google-auth.provider.ts     # Shared GoogleAuth factory
│   ├── sheets.service.ts
│   └── drive.service.ts
├── telegram/
│   ├── telegram.module.ts
│   ├── telegram.service.ts         # ~30 lines: bot init + listener registration
│   ├── telegram.dispatcher.ts      # Routes to correct handler by conversation state
│   └── handlers/
│       ├── menu.handler.ts
│       ├── expense.handler.ts
│       ├── receipt.handler.ts
│       └── query.handler.ts
├── conversation/                   # Unchanged
├── i18n/                           # Unchanged
├── shared/
│   └── interfaces/
│       └── expense.interface.ts    # Unchanged
├── app.module.ts                   # No AppController/AppService
└── main.ts                         # enableShutdownHooks()
```

**Deleted files:** `app.controller.ts`, `app.service.ts`, `app.controller.spec.ts`, `src/openai/` (entire folder), `src/sheets/` (moved to google/), `src/drive/` (moved to google/)

---

## 3. Configuration & Env Validation

**New dependency:** `joi` (already available via `@nestjs/config`)

```typescript
// config/config.schema.ts
export const configSchema = Joi.object({
  TELEGRAM_BOT_TOKEN:     Joi.string().required(),
  OPENAI_API_KEY:         Joi.string().required(),
  GEMINI_API_KEY:         Joi.string().required(),
  GOOGLE_CLIENT_EMAIL:    Joi.string().email().required(),
  GOOGLE_PRIVATE_KEY:     Joi.string().required(),
  GOOGLE_SHEET_ID:        Joi.string().required(),
  GOOGLE_DRIVE_FOLDER_ID: Joi.string().optional(),
  PORT:                   Joi.number().default(3000),
});
```

`AppModule` passes `validationSchema: configSchema` to `ConfigModule.forRoot()`. App fails fast at startup with a clear message if any required variable is missing.

`.env.example` updated to include `GEMINI_API_KEY`.

---

## 4. Google Module

**Replaces:** `src/sheets/` and `src/drive/` (both deleted)

### 4.1 GoogleAuthProvider

A single `GoogleAuth` instance shared across both services. Registered as `'GOOGLE_AUTH'` token.

- Uses `ConfigService` to read `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY`
- Scopes: `spreadsheets` + `drive.file` combined on one auth instance

### 4.2 SheetsService (moved to `google/sheets.service.ts`)

Injects `'GOOGLE_AUTH'`. Initializes `google.sheets()` in `onModuleInit`. Methods unchanged:
- `ensureHeaders()`
- `appendExpense(e: Expense)`
- `getLastExpenses(n: number)`
- `getMonthlySummary(yearMonth: string)`

### 4.3 DriveService (moved to `google/drive.service.ts`)

Injects `'GOOGLE_AUTH'`. Initializes `google.drive()` in `onModuleInit`. Methods unchanged:
- `uploadImage(buffer: Buffer, filename: string): Promise<string>`

### 4.4 GoogleModule

```typescript
@Module({
  providers: [GoogleAuthProvider, SheetsService, DriveService],
  exports: [SheetsService, DriveService],
})
export class GoogleModule {}
```

`TelegramModule` imports `GoogleModule` instead of the old `SheetsModule` + `DriveModule`.

---

## 5. AI Module

**New dependency:** `@google/generative-ai`
**Replaces:** `src/openai/` (deleted)

### 5.1 Interface

```typescript
// ai/connectors/ai-connector.interface.ts
export interface IAiConnector {
  readonly name: string;
  extractFromImage(buffer: Buffer): Promise<Partial<Expense>>;
  classifyIntent(text: string): Promise<string>;
}
```

### 5.2 GeminiConnector

- Uses `@google/generative-ai` SDK with model `gemini-2.0-flash`
- `extractFromImage`: sends base64 image + structured prompt, parses JSON response
- `classifyIntent`: sends text + classification prompt, returns intent string

### 5.3 OpenAiConnector

- Uses `@langchain/openai` with model `gpt-4o-mini`
- Identical interface as current `OpenAiService` — only renamed to `OpenAiConnector`

### 5.4 AiService

```typescript
@Injectable()
export class AiService {
  constructor(
    @Inject('AI_CONNECTORS')
    private readonly connectors: IAiConnector[],
    private readonly logger: Logger,
  ) {}

  async extractFromImage(buffer: Buffer): Promise<Partial<Expense>> {
    for (const connector of this.connectors) {
      try {
        return await connector.extractFromImage(buffer);
      } catch (err) {
        this.logger.warn(`[AI] ${connector.name} failed: ${err.message}`);
      }
    }
    // Safe default — conversation continues, user fills fields manually
    return {
      fecha: new Date().toISOString().split('T')[0],
      proveedor: '', categoria: 'Other', descripcion: '', monto: 0,
    };
  }

  async classifyIntent(text: string): Promise<string> {
    for (const connector of this.connectors) {
      try {
        return await connector.classifyIntent(text);
      } catch (err) {
        this.logger.warn(`[AI] ${connector.name} failed: ${err.message}`);
      }
    }
    return 'UNKNOWN';
  }
}
```

### 5.5 AiModule

Registers `AI_CONNECTORS` as `[GeminiConnector, OpenAiConnector]` — Gemini first, OpenAI second. Adding a third provider (e.g. Claude) requires only a new connector file and appending it to the array.

---

## 6. Telegram Module Refactor

**Goal:** Break `telegram.service.ts` (500+ lines) into focused units.

### 6.1 TelegramService (~30 lines)

Only responsibility: initialize the `TelegramBot` instance and register all message/callback listeners. Delegates everything to `TelegramDispatcher`.

### 6.2 TelegramDispatcher

Receives every incoming message or callback. Uses `ConversationService` to read the current state and routes to the correct handler. Contains no business logic.

**Routing logic:**
- `ConversationState.IDLE` + command `/start` → `MenuHandler`
- `ConversationState.WAITING_AMOUNT|PROVIDER|CATEGORY|DESCRIPTION|CONFIRMATION` → `ExpenseHandler`
- `ConversationState.EDITING_FIELD` → `ExpenseHandler`
- `ConversationState.WAITING_RECEIPT` or photo message → `ReceiptHandler`
- Callback queries prefixed `cmd_`, `confirm_`, `cat_`, `desc_`, `edit_` → routed by prefix
- Free text in IDLE state → `AiService.classifyIntent()` → appropriate handler
- Commands `/gastos`, `/mes` → `QueryHandler`

### 6.3 Handler Interface

```typescript
export interface ITelegramHandler {
  handle(chatId: number, payload?: string | Buffer): Promise<void>;
}
```

### 6.4 MenuHandler

Handles `/start`, `cmd_gasto`, `cmd_factura`, `cmd_gastos`, `cmd_mes`, `back_menu` callbacks. Sends the main menu keyboard.

### 6.5 ExpenseHandler

Handles the full manual expense flow:
- Amount input + validation
- Provider input
- Category selection (inline keyboard)
- Description selection (quick options or custom)
- Confirmation display with edit buttons
- Field editing (EDITING_FIELD state)
- Final save to `SheetsService` and `DriveService`

### 6.6 ReceiptHandler

Handles photo messages:
- Downloads photo buffer via Telegram API
- Calls `AiService.extractFromImage()`
- Pre-fills `pendingExpense` via `ConversationService`
- Transitions to WAITING_CONFIRMATION → delegates to `ExpenseHandler.showConfirmation()`

### 6.7 QueryHandler

Handles read-only queries:
- `/gastos` → `SheetsService.getLastExpenses(5)` → formatted list
- `/mes` → `SheetsService.getMonthlySummary()` → formatted summary

---

## 7. Global Exception Filter

```typescript
@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    this.logger.error('Unhandled exception', exception);
    // For Telegram context: silently log, no crash
  }
}
```

Registered globally in `main.ts` via `app.useGlobalFilters(new GlobalExceptionFilter(...))`.

For exceptions that originate from a Telegram message context (identifiable by chatId), the filter sends `i18n.get('general.error_generic')` to the user so they are never left in silence.

---

## 8. main.ts Changes

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.useGlobalFilters(app.get(GlobalExceptionFilter));
  await app.listen(process.env.PORT ?? 3000);
}
```

---

## 9. Dependencies

**Add:**
```bash
pnpm add @google/generative-ai joi
```

**Remove from active use** (keep in package.json as fallback):
- `langchain` (only `@langchain/openai` and `@langchain/core` needed)

---

## 10. File Change Summary

| Action | Path |
|--------|------|
| DELETE | `src/app.controller.ts` |
| DELETE | `src/app.service.ts` |
| DELETE | `src/app.controller.spec.ts` |
| DELETE | `src/openai/` (entire folder) |
| DELETE | `src/sheets/` (entire folder) |
| DELETE | `src/drive/` (entire folder) |
| CREATE | `src/config/config.schema.ts` |
| CREATE | `src/filters/global-exception.filter.ts` |
| CREATE | `src/ai/ai.module.ts` |
| CREATE | `src/ai/ai.service.ts` |
| CREATE | `src/ai/connectors/ai-connector.interface.ts` |
| CREATE | `src/ai/connectors/gemini.connector.ts` |
| CREATE | `src/ai/connectors/openai.connector.ts` |
| CREATE | `src/google/google.module.ts` |
| CREATE | `src/google/google-auth.provider.ts` |
| CREATE | `src/google/sheets.service.ts` |
| CREATE | `src/google/drive.service.ts` |
| CREATE | `src/telegram/telegram.dispatcher.ts` |
| CREATE | `src/telegram/handlers/menu.handler.ts` |
| CREATE | `src/telegram/handlers/expense.handler.ts` |
| CREATE | `src/telegram/handlers/receipt.handler.ts` |
| CREATE | `src/telegram/handlers/query.handler.ts` |
| MODIFY | `src/app.module.ts` |
| MODIFY | `src/main.ts` |
| MODIFY | `src/telegram/telegram.service.ts` |
| MODIFY | `src/telegram/telegram.module.ts` |
| MODIFY | `.env.example` |
