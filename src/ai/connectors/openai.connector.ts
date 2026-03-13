import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { IAiConnector } from './ai-connector.interface';
import { Expense } from '../../shared/interfaces/expense.interface';
import OpenAI, { toFile } from 'openai';

@Injectable()
export class OpenAiConnector implements IAiConnector, OnModuleInit {
  readonly name = 'OpenAI';
  private readonly logger = new Logger(OpenAiConnector.name);
  private model: ChatOpenAI | null = null;
  private openaiClient: OpenAI | null = null;

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
    this.openaiClient = new OpenAI({ apiKey });
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

  async transcribeAudio(buffer: Buffer): Promise<string> {
    if (!this.openaiClient) throw new Error('OpenAI not configured');
    const transcription = await this.openaiClient.audio.transcriptions.create({
      file: await toFile(buffer, 'voice.ogg', { type: 'audio/ogg' }),
      model: 'whisper-1',
    });
    return transcription.text;
  }
}
