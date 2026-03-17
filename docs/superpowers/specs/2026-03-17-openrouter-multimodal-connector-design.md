# OpenRouter Multimodal Connector — Design Spec

**Date:** 2026-03-17
**Status:** Approved

---

## Problem

The current AI layer uses two separate SDKs and connectors:

- `GeminiConnector` — uses `@google/generative-ai` directly
- `OpenAiConnector` — uses `@langchain/openai` for vision/text + `openai` SDK for Whisper audio

This creates two dependency trees, two authentication paths, and inconsistent fallback behavior across tasks. Audio transcription depends on Whisper's separate API, which cannot be abstracted uniformly with the vision/text path.

## Goal

Replace both connectors with a single `OpenRouterConnector` using `@openrouter/sdk` (confirmed: `npm install @openrouter/sdk`, latest v0.9.11) as the unified gateway. Image extraction and intent classification go through OpenRouter using the multimodal `callModel` pattern. Audio transcription also targets OpenRouter/Gemini, with a validation gate before the native Gemini SDK is removed.

---

## Architecture

### What changes

| File | Action |
|------|--------|
| `src/ai/connectors/openrouter.connector.ts` | Created |
| `src/ai/ai.module.ts` | Updated — see migration plan for intermediate and final states |
| `src/config/config.schema.ts` | Updated — `OPENROUTER_API_KEY` required, `GEMINI_API_KEY` and `OPENAI_API_KEY` optional |
| `package.json` | Add `@openrouter/sdk`; remove `@langchain/openai`, `@langchain/core`, `openai` |

### What is removed only after audio validation

| File | Action |
|------|--------|
| `src/ai/connectors/gemini.connector.ts` | Deleted **after** audio via OpenRouter is validated end-to-end |
| `src/ai/connectors/openai.connector.ts` | Deleted at same time |
| `@google/generative-ai` dependency | Removed at same time |

### What does NOT change

- `src/ai/connectors/ai-connector.interface.ts`
- `src/ai/ai.service.ts`
- All Telegram handlers
- All existing tests outside the connector layer

---

## Connector Design

### SDK initialization

`OpenRouterConnector` initializes the `@openrouter/sdk` client in `onModuleInit`. If `OPENROUTER_API_KEY` is absent it throws immediately — fail fast at startup. The `HTTP-Referer` and `X-Title` headers are included as recommended by OpenRouter for proper rate-limit attribution.

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
  // ...
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

| Task | Primary model | Fallback model |
|------|--------------|----------------|
| `extractFromImage` | `google/gemini-2.0-flash` | `openai/gpt-4o-mini` |
| `classifyIntent` | `openai/gpt-4o-mini` | `google/gemini-2.0-flash` |
| `transcribeAudio` | `google/gemini-2.0-flash` | `google/gemini-1.5-flash` |

> **Note on model slugs:** Verify exact OpenRouter model identifiers at `openrouter.ai/models` before implementation. The slugs above follow the documented `provider/model-name` convention but must be confirmed against the live model list.

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

`tryModels` is called inside each public method. If all models fail, the error propagates to `AiService`, which already has safe defaults for each task. The guard on empty `models` prevents a silent `undefined` throw.

### Audio transcription via multimodal

OpenRouter proxies requests to Gemini via the OpenAI-compatible chat completions API. Gemini 2.0 Flash supports audio inputs natively, but the inline audio format over the OpenAI-compatible schema is **not standardized** and must be validated by the implementer against the OpenRouter docs before writing code.

**Open question for the implementer:** Does `google/gemini-2.0-flash` on OpenRouter accept inline base64 audio (e.g. `audio/ogg`) in the chat completions content array? Consult `openrouter.ai/docs` and test with a real `.ogg` payload before committing to this approach.

**Fallback strategy if OpenRouter does not support audio inline:**
Keep `transcribeAudio` as a direct call to `@google/generative-ai` (isolated in a private method within `OpenRouterConnector`). The public interface stays the same. `@google/generative-ai` is retained as a dependency only in this case.

---

## Module registration

### Intermediate state (migration steps 2–4)

Both old and new connectors are registered. OpenRouter is tried first; Gemini and OpenAI remain as ultimate safety nets.

```typescript
{
  provide: AI_CONNECTORS,
  useFactory: (
    or: OpenRouterConnector,
    gemini: GeminiConnector,
    openai: OpenAiConnector,
  ): IAiConnector[] => [or, gemini, openai],
  inject: [OpenRouterConnector, GeminiConnector, OpenAiConnector],
}
```

### Final state (after audio validation, step 5)

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
// config.schema.ts
OPENROUTER_API_KEY: Joi.string().required(),
GEMINI_API_KEY: Joi.string().optional(),   // was required; retained only if audio validation fails
OPENAI_API_KEY: Joi.string().optional(),   // unchanged
```

---

## Error handling

| Scenario | Behavior |
|----------|----------|
| Primary model rate-limited or times out | `tryModels` logs a warn, tries fallback model silently |
| All models for a task fail | Last error propagates to `AiService`, which returns a safe default |
| `OPENROUTER_API_KEY` missing | `onModuleInit` throws at startup — fail fast |
| `extractFromImage` returns malformed JSON | `JSON.parse` throws, treated as model failure, tries next model |
| `transcribeAudio` returns empty string | Connector throws explicitly, triggers fallback |
| `models` array is empty | `tryModels` throws `Error('No models configured')` immediately |

---

## Migration plan

1. Install `@openrouter/sdk`; remove `@langchain/openai`, `@langchain/core`, `openai`, and delete `OpenAiConnector` and its spec (its deps are gone)
2. Implement `OpenRouterConnector` with `extractFromImage` and `classifyIntent`
3. Register `OpenRouterConnector` + `GeminiConnector` in `ai.module.ts` (intermediate state: OpenRouter first, Gemini as safety net)
4. Validate `extractFromImage` and `classifyIntent` in dev/staging with real payloads
5. Implement `transcribeAudio`: test with a real `.ogg` payload through OpenRouter
   - **If audio works via OpenRouter:** proceed to step 6
   - **If audio fails:** implement via direct `@google/generative-ai` call inside `OpenRouterConnector`; document the limitation
6. Delete `GeminiConnector`, `OpenAiConnector`, their specs; remove `@google/generative-ai`; switch to final `ai.module.ts`

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

Existing connector specs for `GeminiConnector` and `OpenAiConnector` are deleted at step 6 of the migration plan, alongside the source files.
`AiService` specs are unaffected throughout.

---

## Dependencies

**Add:**
```
@openrouter/sdk   (confirmed on npm: v0.9.11)
```

**Remove immediately** (LangChain and direct OpenAI SDK no longer used):
```
@langchain/openai
@langchain/core
openai
```

**Remove after audio validation (step 6):**
```
@google/generative-ai
```
