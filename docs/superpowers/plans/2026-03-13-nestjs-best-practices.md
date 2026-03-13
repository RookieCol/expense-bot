# NestJS Best Practices + Gemini OCR Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor expense-bot applying NestJS best practices: Pino structured logging, Joi env validation, unified GoogleModule with shared auth, provider-agnostic AiModule (Gemini primary + OpenAI fallback), split the 500-line TelegramService into a dispatcher + 4 focused handlers, and add voice note transcription (Gemini Flash + Whisper fallback).

**Architecture:** Feature modules with clear single responsibilities. GoogleModule consolidates Sheets/Drive sharing one GoogleAuth instance. AiModule owns an `IAiConnector[]` array — AiService iterates it blindly, new providers require zero changes to AiService. TelegramModule splits into: BotProvider (bot instance), TelegramService (init + polling), TelegramDispatcher (routing), and 4 handlers (Menu, Expense, Receipt, Query).

**Tech Stack:** NestJS 11, pnpm, `nestjs-pino` + `pino-pretty`, `joi`, `@google/generative-ai` (gemini-2.0-flash), `@langchain/openai` (gpt-4o-mini fallback), `googleapis`

**Spec:** `docs/superpowers/specs/2026-03-13-nestjs-best-practices-design.md`

---

## File Map

```
CREATE  src/config/config.schema.ts
CREATE  src/filters/global-exception.filter.ts
CREATE  src/google/google-auth.provider.ts
CREATE  src/google/sheets.service.ts
CREATE  src/google/drive.service.ts
CREATE  src/google/google.module.ts
CREATE  src/ai/connectors/ai-connector.interface.ts
CREATE  src/ai/connectors/gemini.connector.ts
CREATE  src/ai/connectors/openai.connector.ts
CREATE  src/ai/ai.service.ts
CREATE  src/ai/ai.module.ts
CREATE  src/telegram/bot.provider.ts
CREATE  src/telegram/telegram.dispatcher.ts
CREATE  src/telegram/handlers/menu.handler.ts
CREATE  src/telegram/handlers/expense.handler.ts
CREATE  src/telegram/handlers/receipt.handler.ts
CREATE  src/telegram/handlers/query.handler.ts
MODIFY  src/app.module.ts
MODIFY  src/main.ts
MODIFY  src/ai/connectors/ai-connector.interface.ts   (+ transcribeAudio)
MODIFY  src/ai/connectors/gemini.connector.ts         (+ transcribeAudio via gemini-1.5-flash)
MODIFY  src/ai/connectors/openai.connector.ts         (+ transcribeAudio via whisper-1)
MODIFY  src/ai/ai.service.ts                          (+ transcribeAudio)
MODIFY  src/telegram/telegram.service.ts              (voice download + dispatchVoice)
MODIFY  src/telegram/telegram.dispatcher.ts           (+ dispatchVoice, refactor text routing)
MODIFY  src/telegram/telegram.module.ts
MODIFY  .env.example
DELETE  src/app.controller.ts
DELETE  src/app.service.ts
DELETE  src/app.controller.spec.ts
DELETE  src/openai/openai.service.ts
DELETE  src/openai/openai.module.ts
DELETE  src/sheets/sheets.service.ts
DELETE  src/sheets/sheets.module.ts
DELETE  src/drive/drive.service.ts
DELETE  src/drive/drive.module.ts
```

---

## Chunk 1: Foundation — Pino, Env Validation, Exception Filter

### Task 1: Install dependencies

**Files:** `package.json`, `pnpm-lock.yaml`

- [ ] Run:
```bash
cd /Users/rookiecol/Documents/code/blocanico/expense-bot
pnpm add @google/generative-ai joi nestjs-pino pino-http
pnpm add -D pino-pretty
```
Expected: all packages resolve, no peer-dep errors.

---

### Task 2: Create env validation schema

**Files:**
- Create: `src/config/config.schema.ts`

- [ ] Create the file:

```typescript
import * as Joi from 'joi';

export const configSchema = Joi.object({
  TELEGRAM_BOT_TOKEN:     Joi.string().required(),
  GEMINI_API_KEY:         Joi.string().required(),
  OPENAI_API_KEY:         Joi.string().optional(), // fallback only; connector skips init if absent
  GOOGLE_CLIENT_EMAIL:    Joi.string().email().required(),
  GOOGLE_PRIVATE_KEY:     Joi.string().required(),
  GOOGLE_SHEET_ID:        Joi.string().required(),
  GOOGLE_DRIVE_FOLDER_ID: Joi.string().optional(),
  PORT:                   Joi.number().default(3000),
});
```

---

### Task 3: Create global exception filter

**Files:**
- Create: `src/filters/global-exception.filter.ts`

- [ ] Create the file:

```typescript
import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  Logger,
} from '@nestjs/common';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : exception,
    );
  }
}
```

---

### Task 4: Update app.module.ts — Chunk 1 pass (Pino + Joi only)

**Files:**
- Modify: `src/app.module.ts`

> **Important:** This is a partial update. `SheetsModule`, `DriveModule`, and `OpenAiModule` are kept intentionally — they will be replaced in Tasks 15 and 22 once `GoogleModule` and `AiModule` exist. This ensures the build stays green throughout.

- [ ] Replace entire file:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { configSchema } from './config/config.schema';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { I18nModule } from './i18n/i18n.module';
import { ConversationModule } from './conversation/conversation.module';
import { OpenAiModule } from './openai/openai.module';
import { SheetsModule } from './sheets/sheets.module';
import { DriveModule } from './drive/drive.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: configSchema }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
      },
    }),
    I18nModule,
    ConversationModule,
    OpenAiModule,
    SheetsModule,
    DriveModule,
    TelegramModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
```

---

### Task 5: Update main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] Replace entire file:

```typescript
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

---

### Task 6: Delete boilerplate files

**Files:**
- Delete: `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`

- [ ] Run:
```bash
rm src/app.controller.ts src/app.service.ts src/app.controller.spec.ts
```

---

### Task 7: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] Replace file contents:

```
TELEGRAM_BOT_TOKEN=
GEMINI_API_KEY=
OPENAI_API_KEY=
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SHEET_ID=
GOOGLE_DRIVE_FOLDER_ID=
PORT=3000
```

---

### Task 8: Commit Chunk 1

- [ ] Run:
```bash
git add -A
git commit -m "feat: foundation — Pino logging, Joi env validation, global exception filter"
```

---

## Chunk 2: Google Module

### Task 9: Create shared GoogleAuth provider

**Files:**
- Create: `src/google/google-auth.provider.ts`

- [ ] Create the file:

```typescript
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';

export const GOOGLE_AUTH = 'GOOGLE_AUTH';

export const GoogleAuthProvider = {
  provide: GOOGLE_AUTH,
  useFactory: (config: ConfigService) =>
    new google.auth.GoogleAuth({
      credentials: {
        client_email: config.get<string>('GOOGLE_CLIENT_EMAIL'),
        private_key: config
          .get<string>('GOOGLE_PRIVATE_KEY')
          ?.replace(/\\n/g, '\n'),
      },
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    }),
  inject: [ConfigService],
};
```

---

### Task 10: Create SheetsService in google/

**Files:**
- Create: `src/google/sheets.service.ts`

- [ ] Create the file:

```typescript
import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4, Auth } from 'googleapis';
import { GOOGLE_AUTH } from './google-auth.provider';
import {
  Expense,
  MonthlySummary,
} from '../shared/interfaces/expense.interface';

@Injectable()
export class SheetsService implements OnModuleInit {
  private readonly logger = new Logger(SheetsService.name);
  private sheets: sheets_v4.Sheets;
  private readonly sheetId: string | undefined;

  constructor(
    @Inject(GOOGLE_AUTH) private readonly auth: Auth.GoogleAuth,
    private readonly config: ConfigService,
  ) {
    this.sheetId = this.config.get<string>('GOOGLE_SHEET_ID');
  }

  async onModuleInit() {
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    await this.ensureHeaders();
  }

  private async ensureHeaders() {
    try {
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: 'A1:F1',
      });
      if (!res.data.values?.length) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.sheetId,
          range: 'A1:F1',
          valueInputOption: 'RAW',
          requestBody: {
            values: [
              [
                'date',
                'provider',
                'category',
                'description',
                'amount',
                'receipt_link',
              ],
            ],
          },
        });
      }
    } catch (e) {
      this.logger.warn('Could not verify headers: ' + (e as Error).message);
    }
  }

  async appendExpense(e: Expense): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.sheetId,
      range: 'A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [
            e.fecha,
            e.proveedor,
            e.categoria,
            e.descripcion,
            e.monto,
            e.facturaLink || '',
          ],
        ],
      },
    });
  }

  async getLastExpenses(n = 5): Promise<Expense[]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: 'A:F',
    });
    return (res.data.values || [])
      .slice(1)
      .slice(-n)
      .reverse()
      .map((r) => ({
        fecha: r[0] || '',
        proveedor: r[1] || '',
        categoria: r[2] || '',
        descripcion: r[3] || '',
        monto: parseFloat(r[4]) || 0,
        facturaLink: r[5] || '',
      }));
  }

  async getMonthlySummary(yearMonth: string): Promise<MonthlySummary> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: 'A:F',
    });
    const rows = (res.data.values || [])
      .slice(1)
      .filter((r) => r[0]?.startsWith(yearMonth));
    const porCategoria: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const cat = r[2] || 'Other';
      const amt = parseFloat(r[4]) || 0;
      porCategoria[cat] = (porCategoria[cat] || 0) + amt;
      total += amt;
    }
    return { mes: yearMonth, total, porCategoria, cantidadGastos: rows.length };
  }
}
```

---

### Task 11: Create DriveService in google/

**Files:**
- Create: `src/google/drive.service.ts`

- [ ] Create the file:

```typescript
import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, drive_v3, Auth } from 'googleapis';
import { Readable } from 'stream';
import { GOOGLE_AUTH } from './google-auth.provider';

@Injectable()
export class DriveService implements OnModuleInit {
  private readonly logger = new Logger(DriveService.name);
  private drive: drive_v3.Drive;
  private readonly folderId: string | undefined;

  constructor(
    @Inject(GOOGLE_AUTH) private readonly auth: Auth.GoogleAuth,
    private readonly config: ConfigService,
  ) {
    this.folderId = this.config.get<string>('GOOGLE_DRIVE_FOLDER_ID');
  }

  async onModuleInit() {
    this.drive = google.drive({ version: 'v3', auth: this.auth });
  }

  async uploadImage(buffer: Buffer, filename: string): Promise<string> {
    const res = await this.drive.files.create({
      requestBody: {
        name: filename,
        parents: this.folderId ? [this.folderId] : [],
      },
      media: { mimeType: 'image/jpeg', body: Readable.from(buffer) },
      fields: 'id, webViewLink',
    });
    await this.drive.permissions.create({
      fileId: res.data.id!,
      requestBody: { role: 'reader', type: 'anyone' },
    });
    return (
      res.data.webViewLink ||
      `https://drive.google.com/file/d/${res.data.id}/view`
    );
  }
}
```

---

### Task 12: Create GoogleModule

**Files:**
- Create: `src/google/google.module.ts`

- [ ] Create the file:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GoogleAuthProvider } from './google-auth.provider';
import { SheetsService } from './sheets.service';
import { DriveService } from './drive.service';

@Module({
  imports: [ConfigModule],
  providers: [GoogleAuthProvider, SheetsService, DriveService],
  exports: [SheetsService, DriveService],
})
export class GoogleModule {}
```

---

### Task 13: Delete old sheets/ and drive/ modules

**Files:**
- Delete: `src/sheets/sheets.service.ts`, `src/sheets/sheets.module.ts`, `src/drive/drive.service.ts`, `src/drive/drive.module.ts`

- [ ] Run:
```bash
rm -rf src/sheets src/drive
```

---

### Task 14: Verify build

- [ ] Run:
```bash
pnpm run build 2>&1 | grep -E "error|warning" | head -20
```
Expected: errors only about missing `AiModule` and missing `OpenAiModule` — all other errors should be gone.

---

### Task 15: Commit Chunk 2

- [ ] Run:
```bash
git add -A
git commit -m "feat: consolidate Sheets + Drive into unified GoogleModule with shared auth"
```

---

## Chunk 3: AI Module

### Task 16: Create IAiConnector interface

**Files:**
- Create: `src/ai/connectors/ai-connector.interface.ts`

- [ ] Create the file:

```typescript
import { Expense } from '../../shared/interfaces/expense.interface';

export interface IAiConnector {
  readonly name: string;
  extractFromImage(buffer: Buffer): Promise<Partial<Expense>>;
  classifyIntent(text: string): Promise<string>;
}
```

---

### Task 17: Create GeminiConnector

**Files:**
- Create: `src/ai/connectors/gemini.connector.ts`

- [ ] Create the file:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import { IAiConnector } from './ai-connector.interface';
import { Expense } from '../../shared/interfaces/expense.interface';

const SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

const IMAGE_PROMPT = `Analyze this receipt image and extract the data.
Reply ONLY with a valid JSON object, no markdown, no code blocks:
{
  "fecha": "YYYY-MM-DD",
  "proveedor": "business name",
  "categoria": "one of: Equipment, Maintenance, Utilities, Cleaning, Marketing, Uniforms, Insurance & Health, Administration, Events, Other",
  "descripcion": "brief description",
  "monto": 0.00
}
If a field is unreadable use empty string or 0 for amount.`;

const INTENT_PROMPT = (text: string) =>
  `Classify this message from a climbing gym expense bot user.
Reply with ONLY one word: MANUAL_EXPENSE | QUERY_EXPENSES | MONTHLY_SUMMARY | GREETING | UNKNOWN

Message: "${text}"`;

@Injectable()
export class GeminiConnector implements IAiConnector {
  readonly name = 'Gemini';
  private readonly logger = new Logger(GeminiConnector.name);
  private readonly genai: GoogleGenerativeAI;

  constructor(private readonly config: ConfigService) {
    this.genai = new GoogleGenerativeAI(
      this.config.get<string>('GEMINI_API_KEY')!,
    );
  }

  async extractFromImage(buffer: Buffer): Promise<Partial<Expense>> {
    const model = this.genai.getGenerativeModel({
      model: 'gemini-2.0-flash',
      safetySettings: SAFETY_SETTINGS,
    });
    const result = await model.generateContent([
      { inlineData: { mimeType: 'image/jpeg', data: buffer.toString('base64') } },
      IMAGE_PROMPT,
    ]);
    const text = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(text) as Partial<Expense>;
  }

  async classifyIntent(text: string): Promise<string> {
    const model = this.genai.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(INTENT_PROMPT(text));
    return result.response.text().trim();
  }
}
```

---

### Task 18: Create OpenAiConnector

**Files:**
- Create: `src/ai/connectors/openai.connector.ts`

- [ ] Create the file:

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { IAiConnector } from './ai-connector.interface';
import { Expense } from '../../shared/interfaces/expense.interface';

@Injectable()
export class OpenAiConnector implements IAiConnector, OnModuleInit {
  readonly name = 'OpenAI';
  private readonly logger = new Logger(OpenAiConnector.name);
  private model: ChatOpenAI | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not set — OpenAI fallback disabled');
      return;
    }
    this.model = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      temperature: 0,
      openAIApiKey: apiKey,
    });
  }

  async extractFromImage(buffer: Buffer): Promise<Partial<Expense>> {
    if (!this.model) throw new Error('OpenAI not configured');
    const base64 = buffer.toString('base64');
    const res = await this.model.invoke([
      new HumanMessage({
        content: [
          {
            type: 'text',
            text: `Analyze this receipt image and extract the data.
Reply ONLY with a valid JSON object, no markdown:
{
  "fecha": "YYYY-MM-DD",
  "proveedor": "business name",
  "categoria": "one of: Equipment, Maintenance, Utilities, Cleaning, Marketing, Uniforms, Insurance & Health, Administration, Events, Other",
  "descripcion": "brief description",
  "monto": 0.00
}
If a field is unreadable use empty string or 0 for amount.`,
          },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      }),
    ]);
    return JSON.parse(
      (res.content as string).replace(/```json|```/g, '').trim(),
    ) as Partial<Expense>;
  }

  async classifyIntent(text: string): Promise<string> {
    if (!this.model) throw new Error('OpenAI not configured');
    const res = await this.model.invoke([
      new HumanMessage({
        content: `Classify this message from a climbing gym expense bot user.
Reply with ONLY one word: MANUAL_EXPENSE | QUERY_EXPENSES | MONTHLY_SUMMARY | GREETING | UNKNOWN

Message: "${text}"`,
      }),
    ]);
    return (res.content as string).trim();
  }
}
```

---

### Task 19: Create AiService

**Files:**
- Create: `src/ai/ai.service.ts`

- [ ] Create the file:

```typescript
import { Injectable, Logger, Inject } from '@nestjs/common';
import { IAiConnector } from './connectors/ai-connector.interface';
import { Expense } from '../shared/interfaces/expense.interface';

export const AI_CONNECTORS = 'AI_CONNECTORS';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(AI_CONNECTORS) private readonly connectors: IAiConnector[],
  ) {}

  async extractFromImage(buffer: Buffer): Promise<Partial<Expense>> {
    for (const connector of this.connectors) {
      try {
        return await connector.extractFromImage(buffer);
      } catch (err) {
        this.logger.warn(
          `[AI] ${connector.name} failed: ${(err as Error).message}`,
        );
      }
    }
    // Safe default — conversation continues, user fills fields manually
    return {
      fecha: new Date().toISOString().split('T')[0],
      proveedor: '',
      categoria: 'Other',
      descripcion: '',
      monto: 0,
    };
  }

  async classifyIntent(text: string): Promise<string> {
    for (const connector of this.connectors) {
      try {
        return await connector.classifyIntent(text);
      } catch (err) {
        this.logger.warn(
          `[AI] ${connector.name} failed: ${(err as Error).message}`,
        );
      }
    }
    return 'UNKNOWN';
  }
}
```

---

### Task 20: Create AiModule

**Files:**
- Create: `src/ai/ai.module.ts`

- [ ] Create the file:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService, AI_CONNECTORS } from './ai.service';
import { GeminiConnector } from './connectors/gemini.connector';
import { OpenAiConnector } from './connectors/openai.connector';
import { IAiConnector } from './connectors/ai-connector.interface';

@Module({
  imports: [ConfigModule],
  providers: [
    GeminiConnector,
    OpenAiConnector,
    {
      provide: AI_CONNECTORS,
      useFactory: (
        gemini: GeminiConnector,
        openai: OpenAiConnector,
      ): IAiConnector[] => [gemini, openai],
      inject: [GeminiConnector, OpenAiConnector],
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
```

---

### Task 21: Delete old openai/ module

**Files:**
- Delete: `src/openai/openai.service.ts`, `src/openai/openai.module.ts`

- [ ] Run:
```bash
rm -rf src/openai
```

---

### Task 22: Final update to app.module.ts — replace old modules with GoogleModule + AiModule

**Files:**
- Modify: `src/app.module.ts`

- [ ] Replace entire file:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { configSchema } from './config/config.schema';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { I18nModule } from './i18n/i18n.module';
import { ConversationModule } from './conversation/conversation.module';
import { GoogleModule } from './google/google.module';
import { AiModule } from './ai/ai.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: configSchema }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
      },
    }),
    I18nModule,
    ConversationModule,
    GoogleModule,
    AiModule,
    TelegramModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
```

---

### Task 23: Verify build

- [ ] Run:
```bash
pnpm run build 2>&1 | grep -E "error" | head -20
```
Expected: only errors in `TelegramModule` referencing old paths — resolved in Chunk 4.

---

### Task 23b: Commit Chunk 3

- [ ] Run:
```bash
git add -A
git commit -m "feat: add AiModule with Gemini primary + OpenAI fallback connector array"
```

---

## Chunk 4: Telegram Module Refactor

### Task 24: Create BotProvider

**Files:**
- Create: `src/telegram/bot.provider.ts`

The bot is created with `polling: false` here. `TelegramService.onModuleInit()` starts polling after registering all listeners — avoiding any race condition.

- [ ] Create the file:

```typescript
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';

export const BOT = 'TELEGRAM_BOT';

export const BotProvider = {
  provide: BOT,
  useFactory: (config: ConfigService): TelegramBot =>
    new TelegramBot(config.get<string>('TELEGRAM_BOT_TOKEN')!, {
      polling: false,
    }),
  inject: [ConfigService],
};
```

---

### Task 25: Create MenuHandler

**Files:**
- Create: `src/telegram/handlers/menu.handler.ts`

- [ ] Create the file:

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { BOT } from '../bot.provider';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { I18nService } from '../../i18n/i18n.service';

@Injectable()
export class MenuHandler {
  private readonly logger = new Logger(MenuHandler.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly conversation: ConversationService,
    private readonly i18n: I18nService,
  ) {}

  async showMenu(chatId: number): Promise<void> {
    this.conversation.reset(chatId);
    await this.bot.sendMessage(chatId, this.i18n.get('menu.welcome'), {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: this.i18n.get('menu.btn_log_expense'),
              callback_data: 'cmd_gasto',
            },
            {
              text: this.i18n.get('menu.btn_upload_receipt'),
              callback_data: 'cmd_factura',
            },
          ],
          [
            {
              text: this.i18n.get('menu.btn_recent'),
              callback_data: 'cmd_gastos',
            },
            {
              text: this.i18n.get('menu.btn_summary'),
              callback_data: 'cmd_mes',
            },
          ],
        ],
      },
    });
  }

  async startExpenseFlow(chatId: number): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_AMOUNT);
    await this.bot.sendMessage(chatId, this.i18n.get('expense.ask_amount'), {
      parse_mode: 'MarkdownV2',
    });
  }

  async startReceiptFlow(chatId: number): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_RECEIPT);
    await this.bot.sendMessage(chatId, this.i18n.get('receipt.ask'), {
      parse_mode: 'MarkdownV2',
    });
  }

  async handleCancel(chatId: number): Promise<void> {
    this.conversation.reset(chatId);
    await this.bot.sendMessage(chatId, this.i18n.get('general.cancelled'), {
      parse_mode: 'MarkdownV2',
    });
    setTimeout(() => this.showMenu(chatId), 1000);
  }

  async handleUnknown(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, this.i18n.get('nlp.unknown'), {
      parse_mode: 'MarkdownV2',
    });
  }
}
```

---

### Task 26: Create ExpenseHandler

**Files:**
- Create: `src/telegram/handlers/expense.handler.ts`

- [ ] Create the file:

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { BOT } from '../bot.provider';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { SheetsService } from '../../google/sheets.service';
import { DriveService } from '../../google/drive.service';
import { I18nService } from '../../i18n/i18n.service';
import { Expense } from '../../shared/interfaces/expense.interface';
import { MenuHandler } from './menu.handler';

const CATEGORIES = [
  { label: '🧗 Equipment',          value: 'Equipment' },
  { label: '🔧 Maintenance',        value: 'Maintenance' },
  { label: '💡 Utilities',          value: 'Utilities' },
  { label: '🧹 Cleaning',           value: 'Cleaning' },
  { label: '📣 Marketing',          value: 'Marketing' },
  { label: '👕 Uniforms',           value: 'Uniforms' },
  { label: '🏥 Insurance & Health', value: 'Insurance & Health' },
  { label: '💼 Administration',     value: 'Administration' },
  { label: '🎉 Events',             value: 'Events' },
  { label: '🔀 Other',              value: 'Other' },
];

@Injectable()
export class ExpenseHandler {
  private readonly logger = new Logger(ExpenseHandler.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly conversation: ConversationService,
    private readonly sheets: SheetsService,
    private readonly drive: DriveService,
    private readonly i18n: I18nService,
    private readonly menuHandler: MenuHandler,
  ) {}

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  }

  /** Entry point for all text messages while in an expense flow state */
  async handleText(chatId: number, text: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    switch (ctx.state) {
      case ConversationState.WAITING_AMOUNT:
        return this.handleAmountInput(chatId, text);
      case ConversationState.WAITING_PROVIDER:
        return this.handleProviderInput(chatId, text);
      case ConversationState.WAITING_DESCRIPTION:
        return this.handleDescriptionInput(chatId, text);
      case ConversationState.EDITING_FIELD:
        return this.handleEditInput(chatId, text, ctx.editingField ?? '');
      // WAITING_CATEGORY and WAITING_RECEIPT require button/photo — silently ignore text
      default:
        return;
    }
  }

  private async handleAmountInput(chatId: number, text: string): Promise<void> {
    const monto = parseFloat(text.replace(',', '.'));
    if (isNaN(monto) || monto <= 0) {
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('expense.amount_invalid'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }
    this.conversation.updatePending(chatId, { monto });
    this.conversation.setState(chatId, ConversationState.WAITING_PROVIDER);
    await this.bot.sendMessage(
      chatId,
      this.i18n.get('expense.amount_confirmed', { amount: monto.toFixed(2) }),
      { parse_mode: 'MarkdownV2' },
    );
  }

  private async handleProviderInput(
    chatId: number,
    text: string,
  ): Promise<void> {
    this.conversation.updatePending(chatId, { proveedor: text });
    this.conversation.setState(chatId, ConversationState.WAITING_CATEGORY);
    await this.askCategory(chatId);
  }

  async askCategory(chatId: number): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    for (let i = 0; i < CATEGORIES.length; i += 2) {
      keyboard.push(
        CATEGORIES.slice(i, i + 2).map((c) => ({
          text: c.label,
          callback_data: `cat_${c.value}`,
        })),
      );
    }
    keyboard.push([
      { text: this.i18n.get('general.cancel'), callback_data: 'confirm_no' },
    ]);
    const key = ctx.pendingExpense?.proveedor
      ? 'expense.ask_category'
      : 'expense.ask_category_generic';
    await this.bot.sendMessage(
      chatId,
      this.i18n.get(key, {
        provider: this.escape(ctx.pendingExpense?.proveedor || ''),
      }),
      { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } },
    );
  }

  async handleCategorySelected(
    chatId: number,
    category: string,
  ): Promise<void> {
    this.conversation.updatePending(chatId, { categoria: category });
    await this.askDescription(chatId);
  }

  private async askDescription(chatId: number): Promise<void> {
    this.conversation.setState(chatId, ConversationState.WAITING_DESCRIPTION);
    await this.bot.sendMessage(
      chatId,
      this.i18n.get('expense.ask_description'),
      {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Climbing gear purchase',
                callback_data: 'desc_Climbing gear purchase',
              },
              {
                text: 'Wall maintenance',
                callback_data: 'desc_Wall maintenance',
              },
            ],
            [
              {
                text: 'Monthly service',
                callback_data: 'desc_Monthly service',
              },
              {
                text: 'Cleaning supplies',
                callback_data: 'desc_Cleaning supplies',
              },
            ],
            [
              {
                text: this.i18n.get('expense.desc_opt_custom'),
                callback_data: 'desc_custom',
              },
            ],
          ],
        },
      },
    );
  }

  async handleDescriptionSelected(
    chatId: number,
    desc: string,
  ): Promise<void> {
    if (desc === 'custom') {
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('expense.ask_description_write'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }
    await this.handleDescriptionInput(chatId, desc);
  }

  private async handleDescriptionInput(
    chatId: number,
    text: string,
  ): Promise<void> {
    this.conversation.updatePending(chatId, { descripcion: text });
    this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
    await this.showConfirmation(chatId);
  }

  /** Called by ReceiptHandler after pre-filling pendingExpense */
  async showConfirmation(chatId: number): Promise<void> {
    const e = this.conversation.getContext(chatId).pendingExpense;
    const lines = [
      this.i18n.get('expense.confirmation_title'),
      '',
      `${this.i18n.get('expense.confirmation_date')} ${this.escape(e.fecha || '')}`,
      `${this.i18n.get('expense.confirmation_provider')} ${this.escape(e.proveedor || '')}`,
      `${this.i18n.get('expense.confirmation_category')} ${this.escape(e.categoria || '')}`,
      `${this.i18n.get('expense.confirmation_description')} ${this.escape(e.descripcion || '')}`,
      `${this.i18n.get('expense.confirmation_amount')} \\$${this.escape((e.monto ?? 0).toFixed(2))}`,
      '',
      this.i18n.get('expense.confirmation_question'),
    ];
    await this.bot.sendMessage(chatId, lines.join('\n'), {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: this.i18n.get('general.confirm'),
              callback_data: 'confirm_yes',
            },
            {
              text: this.i18n.get('general.cancel'),
              callback_data: 'confirm_no',
            },
          ],
          [
            {
              text: this.i18n.get('expense.btn_edit_amount'),
              callback_data: 'edit_amount',
            },
            {
              text: this.i18n.get('expense.btn_edit_provider'),
              callback_data: 'edit_provider',
            },
          ],
          [
            {
              text: this.i18n.get('expense.btn_edit_category'),
              callback_data: 'edit_category',
            },
            {
              text: this.i18n.get('expense.btn_edit_description'),
              callback_data: 'edit_description',
            },
          ],
        ],
      },
    });
  }

  async handleEditField(chatId: number, field: string): Promise<void> {
    if (field === 'category') {
      this.conversation.setState(chatId, ConversationState.WAITING_CATEGORY);
      return this.askCategory(chatId);
    }
    this.conversation.setEditingField(chatId, field);
    this.conversation.setState(chatId, ConversationState.EDITING_FIELD);
    const msgMap: Record<string, string> = {
      amount:      'expense.edit_ask_amount',
      provider:    'expense.edit_ask_provider',
      description: 'expense.edit_ask_description',
    };
    const msgKey = msgMap[field];
    if (msgKey) {
      await this.bot.sendMessage(chatId, this.i18n.get(msgKey), {
        parse_mode: 'MarkdownV2',
      });
    }
  }

  private async handleEditInput(
    chatId: number,
    text: string,
    field: string,
  ): Promise<void> {
    switch (field) {
      case 'amount': {
        const monto = parseFloat(text.replace(',', '.'));
        if (isNaN(monto) || monto <= 0) {
          await this.bot.sendMessage(
            chatId,
            this.i18n.get('expense.amount_invalid_edit'),
            { parse_mode: 'MarkdownV2' },
          );
          return;
        }
        this.conversation.updatePending(chatId, { monto });
        break;
      }
      case 'provider':
        this.conversation.updatePending(chatId, { proveedor: text });
        break;
      case 'description':
        this.conversation.updatePending(chatId, { descripcion: text });
        break;
    }
    this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
    await this.showConfirmation(chatId);
  }

  async handleConfirmSave(chatId: number): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const e = { ...ctx.pendingExpense } as Expense;

    await this.bot.sendMessage(chatId, this.i18n.get('expense.saving'), {
      parse_mode: 'MarkdownV2',
    });

    try {
      let receiptLink = '';
      if (ctx.lastImageBuffer) {
        const filename = `receipt_${Date.now()}.jpg`;
        receiptLink = await this.drive.uploadImage(
          ctx.lastImageBuffer,
          filename,
        );
        e.facturaLink = receiptLink;
      }
      if (!e.fecha) e.fecha = new Date().toISOString().split('T')[0];

      await this.sheets.appendExpense(e);

      const msgKey = receiptLink
        ? 'expense.saved_with_receipt'
        : 'expense.saved';
      await this.bot.sendMessage(
        chatId,
        this.i18n.get(msgKey, {
          amount: (e.monto ?? 0).toFixed(2),
          provider: this.escape(e.proveedor || ''),
          link: receiptLink,
        }),
        { parse_mode: 'MarkdownV2' },
      );

      this.conversation.reset(chatId);
      setTimeout(() => this.menuHandler.showMenu(chatId), 1500);
    } catch (err) {
      this.logger.error('Save error', err);
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('expense.save_error'),
        { parse_mode: 'MarkdownV2' },
      );
    }
  }
}
```

---

### Task 27: Create ReceiptHandler

**Files:**
- Create: `src/telegram/handlers/receipt.handler.ts`

> Note: `ReceiptHandler` calls `expenseHandler.showConfirmation()` directly after pre-filling state. This is intentional — `ReceiptHandler → ExpenseHandler` is a one-way dependency with no cycle.

- [ ] Create the file:

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { BOT } from '../bot.provider';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { AiService } from '../../ai/ai.service';
import { I18nService } from '../../i18n/i18n.service';
import { ExpenseHandler } from './expense.handler';

@Injectable()
export class ReceiptHandler {
  private readonly logger = new Logger(ReceiptHandler.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly conversation: ConversationService,
    private readonly ai: AiService,
    private readonly i18n: I18nService,
    private readonly expenseHandler: ExpenseHandler,
  ) {}

  async handlePhoto(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    this.conversation.setState(chatId, ConversationState.WAITING_RECEIPT);

    const processing = await this.bot.sendMessage(
      chatId,
      this.i18n.get('receipt.processing'),
      { parse_mode: 'MarkdownV2' },
    );

    try {
      const photo = msg.photo![msg.photo!.length - 1];
      const fileLink = await this.bot.getFileLink(photo.file_id);
      const res = await axios.get(fileLink, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(res.data as ArrayBuffer);

      this.conversation.setImageBuffer(chatId, buffer);
      const extracted = await this.ai.extractFromImage(buffer);
      if (!extracted.fecha) {
        extracted.fecha = new Date().toISOString().split('T')[0];
      }

      this.conversation.updatePending(chatId, extracted);
      this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);

      try {
        await this.bot.deleteMessage(chatId, processing.message_id);
      } catch {
        // ignore delete errors
      }

      await this.expenseHandler.showConfirmation(chatId);
    } catch (err) {
      this.logger.error('Photo handling error', err);
      await this.bot.sendMessage(chatId, this.i18n.get('receipt.error'), {
        parse_mode: 'MarkdownV2',
      });
    }
  }
}
```

---

### Task 28: Create QueryHandler

**Files:**
- Create: `src/telegram/handlers/query.handler.ts`

- [ ] Create the file:

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { BOT } from '../bot.provider';
import { SheetsService } from '../../google/sheets.service';
import { I18nService } from '../../i18n/i18n.service';

@Injectable()
export class QueryHandler {
  private readonly logger = new Logger(QueryHandler.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly sheets: SheetsService,
    private readonly i18n: I18nService,
  ) {}

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  }

  async handleRecentExpenses(chatId: number): Promise<void> {
    try {
      const expenses = await this.sheets.getLastExpenses(5);
      if (!expenses.length) {
        await this.bot.sendMessage(
          chatId,
          this.i18n.get('queries.no_expenses'),
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }
      const lines = [this.i18n.get('queries.recent_title'), ''];
      for (const exp of expenses) {
        lines.push(
          this.i18n.get('queries.recent_row', {
            date: this.escape(exp.fecha),
            provider: this.escape(exp.proveedor),
            amount: exp.monto.toFixed(2),
            category: this.escape(exp.categoria),
          }),
        );
      }
      await this.bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'MarkdownV2',
      });
    } catch (err) {
      this.logger.error('Get expenses error', err);
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('queries.recent_error'),
        { parse_mode: 'MarkdownV2' },
      );
    }
  }

  async handleMonthlySummary(chatId: number): Promise<void> {
    try {
      const yearMonth = new Date().toISOString().slice(0, 7);
      const summary = await this.sheets.getMonthlySummary(yearMonth);
      const monthName = new Date(yearMonth + '-01').toLocaleDateString(
        'en-US',
        { month: 'long', year: 'numeric' },
      );
      const lines = [
        this.i18n.get('queries.summary_title', {
          month: this.escape(monthName),
        }),
        '',
        this.i18n.get('queries.summary_total', {
          total: summary.total.toFixed(2),
        }),
        this.i18n.get('queries.summary_count', {
          count: summary.cantidadGastos,
        }),
        '',
        this.i18n.get('queries.summary_by_category'),
      ];
      for (const [cat, amount] of Object.entries(summary.porCategoria)) {
        lines.push(
          this.i18n.get('queries.summary_row', {
            category: this.escape(cat),
            amount: (amount as number).toFixed(2),
          }),
        );
      }
      await this.bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'MarkdownV2',
      });
    } catch (err) {
      this.logger.error('Monthly summary error', err);
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('queries.summary_error'),
        { parse_mode: 'MarkdownV2' },
      );
    }
  }
}
```

---

### Task 29: Create TelegramDispatcher

**Files:**
- Create: `src/telegram/telegram.dispatcher.ts`

- [ ] Create the file:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { ConversationService } from '../conversation/conversation.service';
import { ConversationState } from '../conversation/conversation-state.enum';
import { AiService } from '../ai/ai.service';
import { MenuHandler } from './handlers/menu.handler';
import { ExpenseHandler } from './handlers/expense.handler';
import { ReceiptHandler } from './handlers/receipt.handler';
import { QueryHandler } from './handlers/query.handler';

const EXPENSE_STATES = new Set([
  ConversationState.WAITING_AMOUNT,
  ConversationState.WAITING_PROVIDER,
  ConversationState.WAITING_CATEGORY,   // text ignored — user must tap keyboard
  ConversationState.WAITING_DESCRIPTION,
  ConversationState.WAITING_RECEIPT,    // text ignored — user must send a photo
  ConversationState.WAITING_CONFIRMATION,
  ConversationState.EDITING_FIELD,
]);

@Injectable()
export class TelegramDispatcher {
  private readonly logger = new Logger(TelegramDispatcher.name);

  constructor(
    private readonly conversation: ConversationService,
    private readonly ai: AiService,
    private readonly menu: MenuHandler,
    private readonly expense: ExpenseHandler,
    private readonly receipt: ReceiptHandler,
    private readonly query: QueryHandler,
  ) {}

  async dispatchMessage(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;

    if (msg.photo) return this.receipt.handlePhoto(msg);

    const text = msg.text?.trim() ?? '';

    // Named commands
    if (/^\/start/.test(text))               return this.menu.showMenu(chatId);
    if (/^\/(cancel|cancelar)/.test(text))   return this.menu.handleCancel(chatId);
    if (/^\/(gastos|expenses)/.test(text))   return this.query.handleRecentExpenses(chatId);
    if (/^\/(mes|month)/.test(text))         return this.query.handleMonthlySummary(chatId);
    if (/^\/(gasto|expense)/.test(text))     return this.menu.startExpenseFlow(chatId);
    if (/^\/(factura|receipt)/.test(text))   return this.menu.startReceiptFlow(chatId);
    if (text.startsWith('/'))                return; // ignore unknown commands

    // Route by active conversation state
    const ctx = this.conversation.getContext(chatId);
    if (EXPENSE_STATES.has(ctx.state)) {
      return this.expense.handleText(chatId, text);
    }

    // NLP for free text in IDLE
    const intent = await this.ai.classifyIntent(text);
    if (intent === 'MANUAL_EXPENSE')   return this.menu.startExpenseFlow(chatId);
    if (intent === 'QUERY_EXPENSES')   return this.query.handleRecentExpenses(chatId);
    if (intent === 'MONTHLY_SUMMARY')  return this.query.handleMonthlySummary(chatId);
    if (intent === 'GREETING')         return this.menu.showMenu(chatId);

    return this.menu.handleUnknown(chatId);
  }

  async dispatchCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message!.chat.id;
    const data = query.data ?? '';

    if (data === 'cmd_gasto')    return this.menu.startExpenseFlow(chatId);
    if (data === 'cmd_factura')  return this.menu.startReceiptFlow(chatId);
    if (data === 'cmd_gastos')   return this.query.handleRecentExpenses(chatId);
    if (data === 'cmd_mes')      return this.query.handleMonthlySummary(chatId);
    if (data === 'back_menu')    return this.menu.showMenu(chatId);
    if (data === 'confirm_yes')  return this.expense.handleConfirmSave(chatId);
    if (data === 'confirm_no')   return this.menu.handleCancel(chatId);

    if (data.startsWith('cat_'))
      return this.expense.handleCategorySelected(chatId, data.replace('cat_', ''));
    if (data.startsWith('desc_'))
      return this.expense.handleDescriptionSelected(chatId, data.replace('desc_', ''));
    if (data.startsWith('edit_'))
      return this.expense.handleEditField(chatId, data.replace('edit_', ''));

    this.logger.warn(`Unknown callback data: ${data}`);
  }
}
```

---

### Task 30: Rewrite TelegramService

**Files:**
- Modify: `src/telegram/telegram.service.ts`

- [ ] Replace entire file:

```typescript
import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { BOT } from './bot.provider';
import { TelegramDispatcher } from './telegram.dispatcher';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly dispatcher: TelegramDispatcher,
  ) {}

  onModuleInit() {
    this.bot.on('message', (msg) => {
      this.dispatcher.dispatchMessage(msg).catch((err) =>
        this.logger.error('Dispatch error', err),
      );
    });

    this.bot.on('callback_query', async (query) => {
      await this.bot.answerCallbackQuery(query.id).catch(() => null);
      this.dispatcher.dispatchCallback(query).catch((err) =>
        this.logger.error('Callback dispatch error', err),
      );
    });

    this.bot.startPolling();
    this.logger.log('Telegram bot started (polling)');
  }
}
```

---

### Task 31: Update TelegramModule

**Files:**
- Modify: `src/telegram/telegram.module.ts`

- [ ] Replace entire file:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BotProvider } from './bot.provider';
import { TelegramService } from './telegram.service';
import { TelegramDispatcher } from './telegram.dispatcher';
import { MenuHandler } from './handlers/menu.handler';
import { ExpenseHandler } from './handlers/expense.handler';
import { ReceiptHandler } from './handlers/receipt.handler';
import { QueryHandler } from './handlers/query.handler';
import { ConversationModule } from '../conversation/conversation.module';
import { AiModule } from '../ai/ai.module';
import { GoogleModule } from '../google/google.module';

@Module({
  imports: [ConfigModule, ConversationModule, AiModule, GoogleModule],
  providers: [
    BotProvider,
    TelegramService,
    TelegramDispatcher,
    MenuHandler,
    ExpenseHandler,
    ReceiptHandler,
    QueryHandler,
  ],
})
export class TelegramModule {}
```

---

### Task 32: Final build verification

- [ ] Run:
```bash
pnpm run build 2>&1
```
Expected: clean build, zero errors.

If errors appear — fix before committing.

---

### Task 33: Commit Chunk 4

- [ ] Run:
```bash
git add -A
git commit -m "feat: refactor TelegramService into dispatcher + 4 focused handlers"
```

---

### Task 34: Commit Chunk 4

- [ ] Run:
```bash
git add -A
git commit -m "feat: refactor TelegramService into dispatcher + 4 focused handlers"
```

---

## Chunk 5: Voice Note Transcription

**Dependency:** Chunks 3 and 4 must be complete. This chunk modifies files created in both.

**Flow:** `msg.voice → TelegramService downloads audio buffer → dispatcher.dispatchVoice(chatId, buffer) → AiService.transcribeAudio() → text → normal text routing`

**Note:** `openai` is already installed as a dependency of `@langchain/openai`. We add it explicitly for direct imports.

---

### Task 35: Install openai as direct dependency

- [ ] Run:
```bash
pnpm add openai
```

---

### Task 36: Add transcribeAudio to IAiConnector interface

**Files:**
- Modify: `src/ai/connectors/ai-connector.interface.ts`

- [ ] Replace entire file:

```typescript
import { Expense } from '../../shared/interfaces/expense.interface';

export interface IAiConnector {
  readonly name: string;
  extractFromImage(buffer: Buffer): Promise<Partial<Expense>>;
  classifyIntent(text: string): Promise<string>;
  transcribeAudio(buffer: Buffer): Promise<string>;
}
```

---

### Task 37: Implement transcribeAudio in GeminiConnector

**Files:**
- Modify: `src/ai/connectors/gemini.connector.ts`

> **Note:** Telegram voice messages are OGG containers with Opus codec (`audio/ogg`). Gemini lists `audio/ogg` as supported but may return an empty string on Opus-encoded files instead of throwing. The empty-result guard below ensures the fallback to OpenAI Whisper triggers correctly if that happens.

- [ ] Add the method to `GeminiConnector` (after `classifyIntent`):

```typescript
  async transcribeAudio(buffer: Buffer): Promise<string> {
    const model = this.genai.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'audio/ogg',
          data: buffer.toString('base64'),
        },
      },
      'Transcribe this voice message exactly. Return only the transcribed text, nothing else.',
    ]);
    const text = result.response.text().trim();
    if (!text) throw new Error('Gemini returned empty transcription');
    return text;
  }
```

---

### Task 38: Implement transcribeAudio in OpenAiConnector

**Files:**
- Modify: `src/ai/connectors/openai.connector.ts`

- [ ] Add import at the top of the file (after existing imports):

```typescript
import OpenAI, { toFile } from 'openai';
```

- [ ] Add `openaiClient` property to the class (after existing `model` property):

```typescript
  private openaiClient: OpenAI | null = null;
```

- [ ] Update `onModuleInit` to also create the OpenAI client:

```typescript
  onModuleInit() {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not set — OpenAI fallback disabled');
      return;
    }
    this.model = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      temperature: 0,
      openAIApiKey: apiKey,
    });
    this.openaiClient = new OpenAI({ apiKey });
  }
```

- [ ] Add the method to `OpenAiConnector` (after `classifyIntent`):

```typescript
  async transcribeAudio(buffer: Buffer): Promise<string> {
    if (!this.openaiClient) throw new Error('OpenAI not configured');
    const transcription = await this.openaiClient.audio.transcriptions.create({
      file: await toFile(buffer, 'voice.ogg', { type: 'audio/ogg' }),
      model: 'whisper-1',
    });
    return transcription.text;
  }
```

---

### Task 39: Add transcribeAudio to AiService

**Files:**
- Modify: `src/ai/ai.service.ts`

- [ ] Add the method to `AiService` (after `classifyIntent`):

```typescript
  async transcribeAudio(buffer: Buffer): Promise<string> {
    for (const connector of this.connectors) {
      try {
        return await connector.transcribeAudio(buffer);
      } catch (err) {
        this.logger.warn(
          `[AI] ${connector.name} transcription failed: ${(err as Error).message}`,
        );
      }
    }
    return ''; // safe default — empty string treated as unknown intent
  }
```

---

### Task 40: Refactor TelegramDispatcher — extract text routing, add dispatchVoice

**Files:**
- Modify: `src/telegram/telegram.dispatcher.ts`

The `dispatchMessage` text-routing logic is extracted into a private `dispatchTextInput` method so `dispatchVoice` can reuse it.

- [ ] Replace entire file:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { ConversationService } from '../conversation/conversation.service';
import { ConversationState } from '../conversation/conversation-state.enum';
import { AiService } from '../ai/ai.service';
import { MenuHandler } from './handlers/menu.handler';
import { ExpenseHandler } from './handlers/expense.handler';
import { ReceiptHandler } from './handlers/receipt.handler';
import { QueryHandler } from './handlers/query.handler';

const EXPENSE_STATES = new Set([
  ConversationState.WAITING_AMOUNT,
  ConversationState.WAITING_PROVIDER,
  ConversationState.WAITING_CATEGORY,   // text ignored — user must tap keyboard
  ConversationState.WAITING_DESCRIPTION,
  ConversationState.WAITING_RECEIPT,    // text ignored — user must send a photo
  ConversationState.WAITING_CONFIRMATION,
  ConversationState.EDITING_FIELD,
]);

@Injectable()
export class TelegramDispatcher {
  private readonly logger = new Logger(TelegramDispatcher.name);

  constructor(
    private readonly conversation: ConversationService,
    private readonly ai: AiService,
    private readonly menu: MenuHandler,
    private readonly expense: ExpenseHandler,
    private readonly receipt: ReceiptHandler,
    private readonly query: QueryHandler,
  ) {}

  async dispatchMessage(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;

    if (msg.photo) return this.receipt.handlePhoto(msg);

    const text = msg.text?.trim() ?? '';

    // Named commands
    if (/^\/start/.test(text))              return this.menu.showMenu(chatId);
    if (/^\/(cancel|cancelar)/.test(text))  return this.menu.handleCancel(chatId);
    if (/^\/(gastos|expenses)/.test(text))  return this.query.handleRecentExpenses(chatId);
    if (/^\/(mes|month)/.test(text))        return this.query.handleMonthlySummary(chatId);
    if (/^\/(gasto|expense)/.test(text))    return this.menu.startExpenseFlow(chatId);
    if (/^\/(factura|receipt)/.test(text))  return this.menu.startReceiptFlow(chatId);
    if (text.startsWith('/'))               return; // ignore unknown commands

    return this.dispatchTextInput(chatId, text);
  }

  /** Called after voice transcription — routes transcribed text through normal flow */
  async dispatchVoice(chatId: number, buffer: Buffer): Promise<void> {
    const text = await this.ai.transcribeAudio(buffer);
    if (!text) {
      return this.menu.handleUnknown(chatId);
    }
    return this.dispatchTextInput(chatId, text);
  }

  async dispatchCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message!.chat.id;
    const data = query.data ?? '';

    if (data === 'cmd_gasto')   return this.menu.startExpenseFlow(chatId);
    if (data === 'cmd_factura') return this.menu.startReceiptFlow(chatId);
    if (data === 'cmd_gastos')  return this.query.handleRecentExpenses(chatId);
    if (data === 'cmd_mes')     return this.query.handleMonthlySummary(chatId);
    if (data === 'back_menu')   return this.menu.showMenu(chatId);
    if (data === 'confirm_yes') return this.expense.handleConfirmSave(chatId);
    if (data === 'confirm_no')  return this.menu.handleCancel(chatId);

    if (data.startsWith('cat_'))
      return this.expense.handleCategorySelected(chatId, data.replace('cat_', ''));
    if (data.startsWith('desc_'))
      return this.expense.handleDescriptionSelected(chatId, data.replace('desc_', ''));
    if (data.startsWith('edit_'))
      return this.expense.handleEditField(chatId, data.replace('edit_', ''));

    this.logger.warn(`Unknown callback data: ${data}`);
  }

  private async dispatchTextInput(chatId: number, text: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);

    if (EXPENSE_STATES.has(ctx.state)) {
      return this.expense.handleText(chatId, text);
    }

    // NLP for free text in IDLE
    const intent = await this.ai.classifyIntent(text);
    if (intent === 'MANUAL_EXPENSE')  return this.menu.startExpenseFlow(chatId);
    if (intent === 'QUERY_EXPENSES')  return this.query.handleRecentExpenses(chatId);
    if (intent === 'MONTHLY_SUMMARY') return this.query.handleMonthlySummary(chatId);
    if (intent === 'GREETING')        return this.menu.showMenu(chatId);

    return this.menu.handleUnknown(chatId);
  }
}
```

---

### Task 41: Update TelegramService — handle voice messages

**Files:**
- Modify: `src/telegram/telegram.service.ts`

- [ ] Replace entire file:

```typescript
import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { BOT } from './bot.provider';
import { TelegramDispatcher } from './telegram.dispatcher';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly dispatcher: TelegramDispatcher,
  ) {}

  onModuleInit() {
    this.bot.on('message', async (msg) => {
      try {
        if (msg.voice) {
          const fileLink = await this.bot.getFileLink(msg.voice.file_id);
          const res = await axios.get<ArrayBuffer>(fileLink, {
            responseType: 'arraybuffer',
          });
          const buffer = Buffer.from(res.data);
          return await this.dispatcher.dispatchVoice(msg.chat.id, buffer);
        }
        await this.dispatcher.dispatchMessage(msg);
      } catch (err) {
        this.logger.error('Message dispatch error', err);
      }
    });

    this.bot.on('callback_query', async (query) => {
      await this.bot.answerCallbackQuery(query.id).catch(() => null);
      this.dispatcher.dispatchCallback(query).catch((err) =>
        this.logger.error('Callback dispatch error', err),
      );
    });

    this.bot.startPolling();
    this.logger.log('Telegram bot started (polling)');
  }
}
```

---

### Task 42: Verify build

- [ ] Run:
```bash
pnpm run build 2>&1
```
Expected: zero errors.

---

### Task 43: Commit Chunk 5

- [ ] Run:
```bash
git add -A
git commit -m "feat: add voice note transcription (Gemini Flash + Whisper fallback)"
```

---

### Task 44: Final commit

- [ ] Run:
```bash
git add -A
git commit -m "feat: expense-bot complete — NestJS best practices, Gemini OCR, voice transcription"
```
