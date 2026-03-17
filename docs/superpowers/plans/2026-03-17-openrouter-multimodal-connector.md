# OpenRouter Multimodal Connector Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `GeminiConnector` and `OpenAiConnector` with a single `OpenRouterConnector` that routes all AI tasks through OpenRouter using `@openrouter/sdk`.

**Architecture:** A single `OpenRouterConnector` implements the existing `IAiConnector` interface. Internally it uses a `tryModels` helper that iterates a per-task model list, catching errors and falling back to the next model. The `AiService` and all handlers are untouched.

**Tech Stack:** NestJS, `@openrouter/sdk` (v0.9.11), Jest, TypeScript

---

## File Map

| File | Change |
|------|--------|
| `src/ai/connectors/openrouter.connector.ts` | **Create** — new connector |
| `src/ai/connectors/openrouter.connector.spec.ts` | **Create** — unit tests |
| `src/ai/connectors/gemini.connector.ts` | **Delete** |
| `src/ai/connectors/openai.connector.ts` | **Delete** |
| `src/ai/ai.module.ts` | **Modify** — register only `OpenRouterConnector` |
| `src/config/config.schema.ts` | **Modify** — swap key names |
| `package.json` / `pnpm-lock.yaml` | **Modify** — swap deps |

---

## Task 1: Remove old connectors and dependencies

**Files:**
- Delete: `src/ai/connectors/gemini.connector.ts`
- Delete: `src/ai/connectors/openai.connector.ts`

- [ ] **Step 1: Delete old connector files**

```bash
rm src/ai/connectors/gemini.connector.ts
rm src/ai/connectors/openai.connector.ts
```

- [ ] **Step 2: Remove old dependencies**

```bash
pnpm remove @google/generative-ai @langchain/openai @langchain/core openai
```

Expected: pnpm removes the packages without error.

- [ ] **Step 3: Install new dependency**

```bash
pnpm add @openrouter/sdk
```

Expected: `@openrouter/sdk` appears in `dependencies` in `package.json`.

- [ ] **Step 4: Verify build breaks as expected**

```bash
pnpm build 2>&1 | head -30
```

Expected: TypeScript errors about missing `GeminiConnector` and `OpenAiConnector` imports in `ai.module.ts`. This is expected — we fix it in Task 3.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove Gemini and OpenAI connectors and their SDKs"
```

---

## Task 2: Write failing tests for OpenRouterConnector

**Files:**
- Create: `src/ai/connectors/openrouter.connector.spec.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/ai/connectors/openrouter.connector.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OpenRouterConnector } from './openrouter.connector';

const mockGetText = jest.fn();
const mockCallModel = jest.fn(() => ({ getText: mockGetText }));

jest.mock('@openrouter/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    callModel: mockCallModel,
  })),
}));

describe('OpenRouterConnector', () => {
  let connector: OpenRouterConnector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenRouterConnector,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-api-key'),
          },
        },
      ],
    }).compile();

    connector = module.get<OpenRouterConnector>(OpenRouterConnector);
    connector.onModuleInit();
    jest.clearAllMocks();
    mockCallModel.mockReturnValue({ getText: mockGetText });
  });

  describe('tryModels (via classifyIntent)', () => {
    it('returns result from first model when it succeeds', async () => {
      mockGetText.mockResolvedValueOnce('GREETING');
      const result = await connector.classifyIntent('hola');
      expect(result).toBe('GREETING');
      expect(mockCallModel).toHaveBeenCalledTimes(1);
    });

    it('tries second model when first fails', async () => {
      mockGetText
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockResolvedValueOnce('GREETING');
      const result = await connector.classifyIntent('hola');
      expect(result).toBe('GREETING');
      expect(mockCallModel).toHaveBeenCalledTimes(2);
    });

    it('throws last error when all models fail', async () => {
      mockGetText
        .mockRejectedValueOnce(new Error('first fail'))
        .mockRejectedValueOnce(new Error('second fail'));
      await expect(connector.classifyIntent('hola')).rejects.toThrow('second fail');
    });

    it('throws immediately when models array is empty', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (connector as any).tryModels([], async () => 'x'),
      ).rejects.toThrow('No models configured for this task');
    });
  });

  describe('classifyIntent', () => {
    it('returns trimmed string from model', async () => {
      mockGetText.mockResolvedValueOnce('  MANUAL_EXPENSE  ');
      const result = await connector.classifyIntent('gasté 100 en limpieza');
      expect(result).toBe('MANUAL_EXPENSE');
    });
  });

  describe('extractFromImage', () => {
    const validJson = JSON.stringify({
      fecha: '2026-03-17',
      proveedor: 'Supermercado',
      categoria: 'Cleaning',
      descripcion: 'Supplies',
      monto: 50.0,
    });

    it('parses valid JSON response', async () => {
      mockGetText.mockResolvedValueOnce(validJson);
      const result = await connector.extractFromImage(Buffer.from('fake'));
      expect(result.proveedor).toBe('Supermercado');
      expect(result.monto).toBe(50.0);
    });

    it('strips markdown code fences before parsing', async () => {
      mockGetText.mockResolvedValueOnce('```json\n' + validJson + '\n```');
      const result = await connector.extractFromImage(Buffer.from('fake'));
      expect(result.proveedor).toBe('Supermercado');
    });

    it('tries fallback model when JSON parse fails', async () => {
      mockGetText
        .mockResolvedValueOnce('not valid json')
        .mockResolvedValueOnce(validJson);
      const result = await connector.extractFromImage(Buffer.from('fake'));
      expect(result.proveedor).toBe('Supermercado');
      expect(mockCallModel).toHaveBeenCalledTimes(2);
    });
  });

  describe('transcribeAudio', () => {
    it('returns transcription text', async () => {
      mockGetText.mockResolvedValueOnce('compramos escobas nuevas');
      const result = await connector.transcribeAudio(Buffer.from('fake-ogg'));
      expect(result).toBe('compramos escobas nuevas');
    });

    it('throws and tries fallback when response is empty string', async () => {
      mockGetText
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('compramos escobas nuevas');
      const result = await connector.transcribeAudio(Buffer.from('fake-ogg'));
      expect(result).toBe('compramos escobas nuevas');
      expect(mockCallModel).toHaveBeenCalledTimes(2);
    });

    it('throws last error when all models return empty', async () => {
      mockGetText
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');
      await expect(
        connector.transcribeAudio(Buffer.from('fake-ogg')),
      ).rejects.toThrow();
    });
  });

  describe('onModuleInit', () => {
    it('throws when OPENROUTER_API_KEY is missing', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OpenRouterConnector,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(undefined) },
          },
        ],
      }).compile();
      const c = module.get<OpenRouterConnector>(OpenRouterConnector);
      expect(() => c.onModuleInit()).toThrow('OPENROUTER_API_KEY is required');
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test src/ai/connectors/openrouter.connector.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: `Cannot find module './openrouter.connector'` — the file doesn't exist yet.

- [ ] **Step 3: Commit test file**

```bash
git add src/ai/connectors/openrouter.connector.spec.ts
git commit -m "test: add failing tests for OpenRouterConnector"
```

---

## Task 3: Implement OpenRouterConnector

**Files:**
- Create: `src/ai/connectors/openrouter.connector.ts`

- [ ] **Step 1: Create the connector**

```typescript
// src/ai/connectors/openrouter.connector.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenRouter from '@openrouter/sdk';
import { IAiConnector } from './ai-connector.interface';
import { Expense } from '../../shared/interfaces/expense.interface';

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

const AUDIO_PROMPT =
  'Transcribe this voice message exactly. Return only the transcribed text, nothing else.';

@Injectable()
export class OpenRouterConnector implements IAiConnector, OnModuleInit {
  readonly name = 'OpenRouter';
  private readonly logger = new Logger(OpenRouterConnector.name);
  private client!: OpenRouter;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
    this.client = new OpenRouter({
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/blocanico/expense-bot',
        'X-Title': 'expense-bot',
      },
    });
  }

  async extractFromImage(buffer: Buffer): Promise<Partial<Expense>> {
    return this.tryModels(
      ['google/gemini-2.0-flash', 'openai/gpt-4o-mini'],
      async (model) => {
        const base64 = buffer.toString('base64');
        const text = await this.client
          .callModel({
            model,
            input: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
                  },
                  { type: 'input_text', text: IMAGE_PROMPT },
                ],
              },
            ],
          })
          .getText();
        return JSON.parse(text.replace(/```json|```/g, '').trim()) as Partial<Expense>;
      },
    );
  }

  async classifyIntent(text: string): Promise<string> {
    return this.tryModels(
      ['openai/gpt-4o-mini', 'google/gemini-2.0-flash'],
      async (model) => {
        const result = await this.client
          .callModel({ model, input: INTENT_PROMPT(text) })
          .getText();
        return result.trim();
      },
    );
  }

  async transcribeAudio(buffer: Buffer): Promise<string> {
    return this.tryModels(
      ['google/gemini-2.0-flash', 'google/gemini-1.5-flash'],
      async (model) => {
        const base64 = buffer.toString('base64');
        const text = await this.client
          .callModel({
            model,
            input: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: { type: 'base64', media_type: 'audio/ogg', data: base64 },
                  },
                  { type: 'input_text', text: AUDIO_PROMPT },
                ],
              },
            ],
          })
          .getText();
        if (!text) throw new Error('OpenRouter returned empty transcription');
        return text;
      },
    );
  }

  private async tryModels<T>(
    models: string[],
    fn: (model: string) => Promise<T>,
  ): Promise<T> {
    if (!models.length) throw new Error('No models configured for this task');
    let lastError!: Error;
    for (const model of models) {
      try {
        return await fn(model);
      } catch (err) {
        this.logger.warn(
          `[OpenRouter] ${model} failed: ${(err as Error).message}`,
        );
        lastError = err as Error;
      }
    }
    throw lastError;
  }
}
```

- [ ] **Step 2: Run tests**

```bash
pnpm test src/ai/connectors/openrouter.connector.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: All tests pass (8 tests, 0 failures).

- [ ] **Step 3: Commit**

```bash
git add src/ai/connectors/openrouter.connector.ts
git commit -m "feat: implement OpenRouterConnector with per-task model fallback"
```

---

## Task 4: Update module and config

**Files:**
- Modify: `src/ai/ai.module.ts`
- Modify: `src/config/config.schema.ts`

- [ ] **Step 1: Replace `ai.module.ts`**

```typescript
// src/ai/ai.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService, AI_CONNECTORS } from './ai.service';
import { OpenRouterConnector } from './connectors/openrouter.connector';
import { IAiConnector } from './connectors/ai-connector.interface';

@Module({
  imports: [ConfigModule],
  providers: [
    OpenRouterConnector,
    {
      provide: AI_CONNECTORS,
      useFactory: (or: OpenRouterConnector): IAiConnector[] => [or],
      inject: [OpenRouterConnector],
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
```

- [ ] **Step 2: Update `config.schema.ts`**

Replace `GEMINI_API_KEY` (required) and `OPENAI_API_KEY` (optional) with `OPENROUTER_API_KEY`:

```typescript
// src/config/config.schema.ts
import * as Joi from 'joi';

export const configSchema = Joi.object({
  TELEGRAM_BOT_TOKEN: Joi.string().required(),
  TELEGRAM_TRANSPORT: Joi.string().valid('polling', 'webhook').default('polling'),
  TELEGRAM_WEBHOOK_URL: Joi.string().uri().optional(),
  TELEGRAM_WEBHOOK_SECRET: Joi.string().optional(),
  OPENROUTER_API_KEY: Joi.string().required(),
  GOOGLE_CLIENT_EMAIL: Joi.string().email().required(),
  GOOGLE_PRIVATE_KEY: Joi.string().required(),
  GOOGLE_SHEET_ID: Joi.string().required(),
  GOOGLE_DRIVE_FOLDER_ID: Joi.string().optional(),
  PORT: Joi.number().default(3000),
});
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
pnpm build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Run full test suite**

```bash
pnpm test --no-coverage 2>&1 | tail -20
```

Expected: All tests pass. The new connector spec passes; `AiService` specs (if any) are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/ai/ai.module.ts src/config/config.schema.ts
git commit -m "feat: wire OpenRouterConnector into AiModule, update config schema"
```

---

## Task 5: Update .env.example and verify startup

**Files:**
- Modify: `.env.example` (if it exists)

- [ ] **Step 1: Update env example**

```bash
# Check if .env.example exists
ls .env.example 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

If it exists, replace `GEMINI_API_KEY` and `OPENAI_API_KEY` lines with:

```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

- [ ] **Step 2: Verify the app starts with a real key (manual)**

Set `OPENROUTER_API_KEY` in your local `.env`, then:

```bash
pnpm start:dev 2>&1 | head -20
```

Expected: App starts, NestJS logs show no errors about missing API keys.

- [ ] **Step 3: Validate audio transcription end-to-end (manual)**

> The OpenRouter/Gemini inline audio format is not standardized — this step confirms it works before the migration is considered complete.

Send a real voice message via Telegram to the bot and confirm the transcription is returned. If transcription returns empty or errors, the `type: 'image'` + `media_type: 'audio/ogg'` content shape may need adjustment. Consult `openrouter.ai/docs` for the correct field names for Gemini audio inputs.

- [ ] **Step 3: Commit .env changes if needed**

```bash
git add .env.example
git commit -m "chore: update env example for OpenRouter migration"
```

---

## Final checks

- [ ] `pnpm build` passes with zero errors
- [ ] `pnpm test --no-coverage` passes all tests
- [ ] `pnpm lint` reports no new errors
- [ ] `.env` has `OPENROUTER_API_KEY` set; `GEMINI_API_KEY` and `OPENAI_API_KEY` are no longer required
