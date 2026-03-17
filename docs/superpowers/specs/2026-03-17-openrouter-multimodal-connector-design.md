# OpenRouter Multimodal Connector — Design Spec

**Date:** 2026-03-17
**Status:** Approved

---

## Problem

The current AI layer uses two separate SDKs and connectors:

- `GeminiConnector` — uses `@google/generative-ai` directly
- `OpenAiConnector` — uses `@langchain/openai` for vision/text + `openai` SDK for Whisper audio

This creates two dependency trees, two authentication paths, and inconsistent fallback behavior across tasks.

## Goal

Replace both connectors with a single `OpenRouterConnector` using `@openrouter/sdk` (confirmed on npm: v0.9.11) as the unified gateway. All three tasks — image extraction, intent classification, and audio transcription — go through OpenRouter. Old connectors and their SDKs are deleted in one step.

---

## Architecture

### What changes

| File | Action |
|------|--------|
| `src/ai/connectors/gemini.connector.ts` | Deleted |
| `src/ai/connectors/openai.connector.ts` | Deleted |
| `src/ai/connectors/openrouter.connector.ts` | Created |
| `src/ai/ai.module.ts` | Updated — registers only `OpenRouterConnector` |
| `src/config/config.schema.ts` | `OPENROUTER_API_KEY` required; `GEMINI_API_KEY` and `OPENAI_API_KEY` removed |
| `package.json` | Add `@openrouter/sdk`; remove `@google/generative-ai`, `@langchain/openai`, `@langchain/core`, `openai` |

### What does NOT change

- `src/ai/connectors/ai-connector.interface.ts`
- `src/ai/ai.service.ts`
- All Telegram handlers
- All existing tests outside the connector layer

---

## Connector Design

### SDK initialization

`OpenRouterConnector` initializes the client in `onModuleInit`. Throws at startup if `OPENROUTER_API_KEY` is absent. Includes `HTTP-Referer` and `X-Title` headers for OpenRouter rate-limit attribution.

```typescript
@Injectable()
export class OpenRouterConnector implements IAiConnector, OnModuleInit {
  readonly name = 'OpenRouter';
  private readonly logger = new Logger(OpenRouterConnector.name);
  private client: OpenRouter;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
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
}
```

### Interface (unchanged)

```typescript
export interface IAiConnector {
  readonly name: string;
  extractFromImage(buffer: Buffer): Promise<Partial<Expense>>;
  classifyIntent(text: string): Promise<string>;
  transcribeAudio(buffer: Buffer): Promise<string>;
}
```

### Model selection per task

Verify exact slugs at `openrouter.ai/models` before implementation.

| Task | Primary model | Fallback model |
|------|--------------|----------------|
| `extractFromImage` | `google/gemini-2.0-flash` | `openai/gpt-4o-mini` |
| `classifyIntent` | `openai/gpt-4o-mini` | `google/gemini-2.0-flash` |
| `transcribeAudio` | `google/gemini-2.0-flash` | `google/gemini-1.5-flash` |

### Internal fallback helper

```typescript
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
      this.logger.warn(`[OpenRouter] ${model} failed: ${(err as Error).message}`);
      lastError = err as Error;
    }
  }
  throw lastError;
}
```

If all models fail, the error propagates to `AiService`, which already has safe defaults per task.

### Audio transcription via multimodal

Gemini 2.0 Flash on OpenRouter accepts audio inline as base64 via the chat completions content array. The implementer must confirm the exact content type field (`input_image` vs `image` with `source`) by consulting `openrouter.ai/docs` and testing with a real `.ogg` payload. The intent and message structure:

```typescript
// Conceptual — confirm exact field names against @openrouter/sdk types
input: [{
  role: 'user',
  content: [
    { type: 'image', source: { type: 'base64', media_type: 'audio/ogg', data: base64 } },
    { type: 'input_text', text: 'Transcribe this voice message exactly. Return only the transcribed text.' }
  ]
}]
```

If the `callModel` response is an empty string, throw — `tryModels` will try the fallback model.

---

## Module registration

```typescript
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

---

## Configuration

```typescript
// config.schema.ts — final state
OPENROUTER_API_KEY: Joi.string().required(),
// GEMINI_API_KEY and OPENAI_API_KEY removed
```

---

## Error handling

| Scenario | Behavior |
|----------|----------|
| Primary model rate-limited or times out | `tryModels` logs warn, tries fallback model |
| All models for a task fail | Last error propagates to `AiService` safe default |
| `OPENROUTER_API_KEY` missing | `onModuleInit` throws at startup |
| `extractFromImage` returns malformed JSON | `JSON.parse` throws → `tryModels` tries next model |
| `transcribeAudio` returns empty string | Connector throws explicitly → `tryModels` tries next model |
| `models` array is empty | `tryModels` throws `Error('No models configured')` |

---

## Migration plan

1. Remove `@langchain/openai`, `@langchain/core`, `openai`, `@google/generative-ai`; delete `GeminiConnector`, `OpenAiConnector`, and their specs
2. Add `@openrouter/sdk`; create `OpenRouterConnector`
3. Update `ai.module.ts` and `config.schema.ts`
4. Test all three tasks with real payloads (`jpg` receipt, text message, `.ogg` voice)

---

## Testing

New file: `src/ai/connectors/openrouter.connector.spec.ts`

Test cases:
1. `tryModels` returns result from first model when it succeeds
2. `tryModels` skips failed first model and returns result from second
3. `tryModels` throws the last error when all models fail
4. `tryModels` throws immediately when passed an empty array
5. `extractFromImage` parses JSON response correctly
6. `extractFromImage` strips markdown code fences before parsing
7. `transcribeAudio` throws on empty response string
8. `classifyIntent` returns trimmed string from model

`AiService` specs are unaffected.

---

## Dependencies

**Add:**
```
@openrouter/sdk
```

**Remove:**
```
@google/generative-ai
@langchain/openai
@langchain/core
openai
```
