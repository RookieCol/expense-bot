import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing';
import { IAiConnector } from './ai-connector.interface';
import { Expense } from '../../shared/interfaces/expense.interface';
import { ExpenseExtractionSchema } from '../schemas/expense.schema';
import { IntentSchema } from '../schemas/intent.schema';
import { receiptExtractPrompt } from '../prompts/receipt-extract.prompt';
import { textExtractPrompt } from '../prompts/text-extract.prompt';
import { intentClassifyPrompt } from '../prompts/intent-classify.prompt';

/**
 * AI connector backed by the Vercel AI SDK targeting OpenRouter via its
 * OpenAI-compatible REST endpoint. Tracing flows through OpenTelemetry:
 * AI SDK emits spans automatically when `experimental_telemetry` is
 * enabled, and `propagateAttributes` lets us attach userId/sessionId to
 * the span tree so Langfuse can group traces by conversation.
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

function traceAttrs(chatId?: string): { userId?: string; sessionId?: string } {
  return chatId ? { userId: chatId, sessionId: chatId } : {};
}

@Injectable()
export class VercelAiConnector implements IAiConnector, OnModuleInit {
  readonly name = 'VercelAI';
  private readonly logger = new Logger(VercelAiConnector.name);
  private openrouter!: OpenAIProvider;
  private apiKey!: string;

  constructor(private readonly config: ConfigService) {}

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

  async extractFromImage(
    buffer: Buffer,
    chatId?: string,
  ): Promise<Partial<Expense>> {
    return propagateAttributes(traceAttrs(chatId), () =>
      startActiveObservation('extract-image', () =>
        this.tryModels(
          ['google/gemini-2.0-flash-001', 'openai/gpt-4o-mini'],
          async (model) => {
            const { object } = await generateObject({
              model: this.openrouter.chat(model),
              schema: ExpenseExtractionSchema,
              messages: receiptExtractPrompt(buffer),
              experimental_telemetry: {
                isEnabled: true,
                functionId: 'extract-image',
                metadata: { model },
              },
            });
            return object;
          },
        ),
      ),
    );
  }

  async extractFromText(
    text: string,
    chatId?: string,
  ): Promise<Partial<Expense>> {
    return propagateAttributes(traceAttrs(chatId), () =>
      startActiveObservation('extract-text', () =>
        this.tryModels(
          ['google/gemini-2.0-flash-001', 'openai/gpt-4o-mini'],
          async (model) => {
            const { object } = await generateObject({
              model: this.openrouter.chat(model),
              schema: ExpenseExtractionSchema,
              prompt: textExtractPrompt(text),
              experimental_telemetry: {
                isEnabled: true,
                functionId: 'extract-text',
                metadata: { model, inputText: text },
              },
            });
            return object;
          },
        ),
      ),
    );
  }

  async classifyIntent(text: string, chatId?: string): Promise<string> {
    return propagateAttributes(traceAttrs(chatId), () =>
      startActiveObservation('classify-intent', () =>
        this.tryModels(
          ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-001'],
          async (model) => {
            const { object } = await generateObject({
              model: this.openrouter.chat(model),
              schema: IntentSchema,
              prompt: intentClassifyPrompt(text),
              experimental_telemetry: {
                isEnabled: true,
                functionId: 'classify-intent',
                metadata: { model, inputText: text },
              },
            });
            return object.intent;
          },
        ),
      ),
    );
  }

  async transcribeAudio(buffer: Buffer, chatId?: string): Promise<string> {
    return propagateAttributes(traceAttrs(chatId), () =>
      startActiveObservation('transcribe-audio', async () => {
        let lastError!: Error;

        // gpt-audio-mini path: convert OGG→MP3, send as raw chat
        // completion with an input_audio content part. Not yet exposed
        // via the AI SDK — manual OTel span captures it.
        try {
          return await startActiveObservation(
            'transcribe-audio.openai',
            async (span) => {
              const mp3Buffer = await oggToMp3(buffer);
              const mp3Base64 = mp3Buffer.toString('base64');
              const res = await fetch(
                'https://openrouter.ai/api/v1/chat/completions',
                {
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
                            input_audio: {
                              data: mp3Base64,
                              format: 'mp3',
                            },
                          },
                        ],
                      },
                    ],
                  }),
                },
              );
              if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${await res.text()}`);
              }
              const json = (await res.json()) as {
                choices?: { message?: { content?: string } }[];
              };
              const text = json.choices?.[0]?.message?.content?.trim();
              if (!text) {
                throw new Error('gpt-audio-mini returned empty transcription');
              }
              span.update({
                input: AUDIO_PROMPT,
                output: text,
                model: 'openai/gpt-audio-mini',
              });
              return text;
            },
            { asType: 'generation' },
          );
        } catch (err) {
          this.logger.warn(
            `[VercelAI] openai/gpt-audio-mini failed: ${(err as Error).message}`,
          );
          lastError = err as Error;
        }

        // Fallback: Gemini via AI SDK (auto-instrumented).
        try {
          const { text } = await generateText({
            model: this.openrouter.chat('google/gemini-2.5-flash-lite'),
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
            experimental_telemetry: {
              isEnabled: true,
              functionId: 'transcribe-audio.gemini',
            },
          });
          if (!text) throw new Error('Gemini returned empty transcription');
          return text;
        } catch (err) {
          this.logger.warn(
            `[VercelAI] gemini transcription failed: ${(err as Error).message}`,
          );
          throw lastError ?? err;
        }
      }),
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
          `[VercelAI] ${model} failed: ${(err as Error).message}`,
        );
        lastError = err as Error;
      }
    }
    throw lastError;
  }
}
