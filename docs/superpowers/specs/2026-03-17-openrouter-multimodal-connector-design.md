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

Replace both connectors with a single `OpenRouterConnector` using `@openrouter/sdk` as the unified gateway. All three AI tasks (image extraction, intent classification, audio transcription) go through OpenRouter using the multimodal `callModel` pattern. No separate Whisper API.

---

## Architecture

### What changes

| File | Action |
|------|--------|
| `src/ai/connectors/gemini.connector.ts` | Deleted |
| `src/ai/connectors/openai.connector.ts` | Deleted |
| `src/ai/connectors/openrouter.connector.ts` | Created |
| `src/ai/ai.module.ts` | Updated — registers only `OpenRouterConnector` |
| `src/config/config.schema.ts` | Updated — `OPENROUTER_API_KEY` required, `GEMINI_API_KEY` optional |
| `package.json` | Add `@openrouter/sdk`; remove `@google/generative-ai`, `@langchain/openai`, `@langchain/core` |

### What does NOT change

- `src/ai/connectors/ai-connector.interface.ts`
- `src/ai/ai.service.ts`
- All Telegram handlers
- All existing tests outside the connector layer

---

## Connector Design

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
| `transcribeAudio` | `google/gemini-2.0-flash` | `google/gemini-flash-1.5` |

### Internal fallback helper

```typescript
private async tryModels<T>(
  models: string[],
  fn: (model: string) => Promise<T>,
): Promise<T> {
  let lastError: Error;
  for (const model of models) {
    try {
      return await fn(model);
    } catch (err) {
      this.logger.warn(`[OpenRouter] ${model} failed: ${err.message}`);
      lastError = err as Error;
    }
  }
  throw lastError!;
}
```

`tryModels` is called inside each public method. If all models fail, the error propagates to `AiService`, which already has safe defaults for each task.

### Audio transcription via multimodal

Gemini 2.0 Flash on OpenRouter accepts audio as base64 inline content — same pattern as images, different `media_type`:

```typescript
input: [{
  role: 'user',
  content: [
    { type: 'input_image', source: { type: 'base64', media_type: 'audio/ogg', data: base64 } },
    { type: 'input_text', text: 'Transcribe this voice message exactly. Return only the transcribed text.' }
  ]
}]
```

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

The `AiService` fallback loop over `AI_CONNECTORS[]` still works — it just has a single-element array now. No changes to `AiService`.

---

## Configuration

```typescript
// config.schema.ts additions
OPENROUTER_API_KEY: Joi.string().required(),
GEMINI_API_KEY: Joi.string().optional(),   // was required, now optional
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

---

## Testing

New file: `src/ai/connectors/openrouter.connector.spec.ts`

Test cases:
1. `tryModels` returns result from first model when it succeeds
2. `tryModels` skips failed first model and returns result from second
3. `tryModels` throws the last error when all models fail
4. `extractFromImage` parses JSON response correctly
5. `extractFromImage` strips markdown code fences before parsing
6. `transcribeAudio` throws on empty response string
7. `classifyIntent` returns trimmed string from model

Existing connector specs for `GeminiConnector` and `OpenAiConnector` are deleted alongside the files.
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
```

`openai` package may be retained if used elsewhere; otherwise also removable.
