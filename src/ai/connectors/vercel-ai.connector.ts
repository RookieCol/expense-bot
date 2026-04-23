import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { IAiConnector } from './ai-connector.interface';
import { Expense } from '../../shared/interfaces/expense.interface';
import { ExpenseExtractionSchema } from '../schemas/expense.schema';
import { IntentSchema } from '../schemas/intent.schema';
import { receiptExtractPrompt } from '../prompts/receipt-extract.prompt';
import { textExtractPrompt } from '../prompts/text-extract.prompt';
import { intentClassifyPrompt } from '../prompts/intent-classify.prompt';
import { LangfuseService } from '../langfuse/langfuse.service';

/**
 * AI connector backed by the Vercel AI SDK targeting OpenRouter via its
 * OpenAI-compatible REST endpoint.
 *
 * Why this replaces OpenRouterConnector:
 *  - generateObject({ schema }) enforces structured output via Zod, so
 *    we delete the hand-rolled JSON.parse + regex code-fence stripping
 *    that the previous connector relied on.
 *  - Prompts and category enums live in their own files; changing a
 *    category no longer requires editing two places (the category
 *    source of truth is CATEGORIES → ExpenseExtractionSchema).
 *  - The provider is OpenAI-compatible so any OpenRouter model id works
 *    and the fallback loop stays exactly the same.
 *
 * transcribeAudio intentionally stays as a raw fetch: gpt-audio-mini
 * uses input_audio content parts that are not yet in the AI SDK's
 * stable surface. Migrating it is Phase 2.5 material.
 */

function oggToMp3(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i',
      'pipe:0',
      '-f',
      'mp3',
      '-ab',
      '64k',
      'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    ff.stdout.on('data', (d: Buffer) => chunks.push(d));
    ff.stderr.on('data', () => {});
    ff.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`ffmpeg exited ${code}`)),
    );
    ff.stdin.write(input);
    ff.stdin.end();
  });
}

const AUDIO_PROMPT =
  'Transcribe this voice message exactly. Return only the transcribed text, nothing else.';

@Injectable()
export class VercelAiConnector implements IAiConnector, OnModuleInit {
  readonly name = 'VercelAI';
  private readonly logger = new Logger(VercelAiConnector.name);
  private openrouter!: OpenAIProvider;
  private apiKey!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly langfuse: LangfuseService,
  ) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
    this.apiKey = apiKey;
    this.openrouter = createOpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        'HTTP-Referer': 'https://github.com/blocanico/expense-bot',
        'X-Title': 'expense-bot',
      },
    });
  }

  async extractFromImage(buffer: Buffer): Promise<Partial<Expense>> {
    const trace = this.langfuse.trace('extract-image', {
      imageBytes: buffer.length,
    });
    return this.tryModels(
      ['google/gemini-2.0-flash-001', 'openai/gpt-4o-mini'],
      async (model) => {
        const gen = trace?.generation({
          name: `vercel-ai:${model}`,
          model,
          input: 'receipt-image',
        });
        try {
          const { object } = await generateObject({
            model: this.openrouter(model),
            schema: ExpenseExtractionSchema,
            messages: receiptExtractPrompt(buffer),
          });
          gen?.end({ output: object });
          return object;
        } catch (err) {
          gen?.end({
            level: 'ERROR',
            statusMessage: (err as Error).message,
          });
          throw err;
        }
      },
    );
  }

  async extractFromText(text: string): Promise<Partial<Expense>> {
    const trace = this.langfuse.trace('extract-text', { inputText: text });
    return this.tryModels(
      ['google/gemini-2.0-flash-001', 'openai/gpt-4o-mini'],
      async (model) => {
        const prompt = textExtractPrompt(text);
        const gen = trace?.generation({
          name: `vercel-ai:${model}`,
          model,
          input: prompt,
        });
        try {
          const { object } = await generateObject({
            model: this.openrouter(model),
            schema: ExpenseExtractionSchema,
            prompt,
          });
          gen?.end({ output: object });
          return object;
        } catch (err) {
          gen?.end({
            level: 'ERROR',
            statusMessage: (err as Error).message,
          });
          throw err;
        }
      },
    );
  }

  async classifyIntent(text: string): Promise<string> {
    const trace = this.langfuse.trace('classify-intent', { inputText: text });
    return this.tryModels(
      ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-001'],
      async (model) => {
        const prompt = intentClassifyPrompt(text);
        const gen = trace?.generation({
          name: `vercel-ai:${model}`,
          model,
          input: prompt,
        });
        try {
          const { object } = await generateObject({
            model: this.openrouter(model),
            schema: IntentSchema,
            prompt,
          });
          gen?.end({ output: object.intent });
          return object.intent;
        } catch (err) {
          gen?.end({
            level: 'ERROR',
            statusMessage: (err as Error).message,
          });
          throw err;
        }
      },
    );
  }

  async transcribeAudio(buffer: Buffer): Promise<string> {
    let lastError!: Error;

    // gpt-audio-mini path: convert OGG→MP3, send as raw chat completion
    // with an input_audio content part. Not yet exposed via the AI SDK.
    try {
      const mp3Buffer = await oggToMp3(buffer);
      const mp3Base64 = mp3Buffer.toString('base64');
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/blocanico/expense-bot',
          'X-Title': 'expense-bot',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/gpt-audio-mini',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: AUDIO_PROMPT },
                {
                  type: 'input_audio',
                  input_audio: { data: mp3Base64, format: 'mp3' },
                },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('gpt-audio-mini returned empty transcription');
      return text;
    } catch (err) {
      this.logger.warn(
        `[VercelAI] openai/gpt-audio-mini failed: ${(err as Error).message}`,
      );
      lastError = err as Error;
    }

    // Fallback: Gemini via AI SDK
    try {
      const { text } = await import('ai').then(({ generateText }) =>
        generateText({
          model: this.openrouter('google/gemini-2.5-flash-lite'),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: AUDIO_PROMPT },
                {
                  type: 'file',
                  data: buffer,
                  mediaType: 'audio/ogg',
                } as unknown as { type: 'text'; text: string },
              ],
            },
          ],
        }),
      );
      if (!text) throw new Error('Gemini returned empty transcription');
      return text;
    } catch (err) {
      this.logger.warn(
        `[VercelAI] gemini transcription failed: ${(err as Error).message}`,
      );
      throw lastError ?? err;
    }
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
          `[VercelAI] ${model} failed: ${(err as Error).message}`,
        );
        lastError = err as Error;
      }
    }
    throw lastError;
  }
}
