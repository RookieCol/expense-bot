// src/ai/connectors/openrouter.connector.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as OpenRouterNS from '@openrouter/sdk';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client!: any;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ns = OpenRouterNS as any;
    const OpenRouter =
      typeof ns?.default?.default === 'function'
        ? ns.default.default
        : typeof ns?.default === 'function'
          ? ns.default
          : ns;
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          } as any)
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          } as any)
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
