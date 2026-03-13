import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { Expense } from '../shared/interfaces/expense.interface';

@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private model: ChatOpenAI;

  constructor(private config: ConfigService) {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      temperature: 0,
      openAIApiKey: this.config.get<string>('OPENAI_API_KEY'),
    });
  }

  async extractFromImage(buffer: Buffer): Promise<Partial<Expense>> {
    try {
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
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64}` },
            },
          ],
        }),
      ]);
      return JSON.parse(
        (res.content as string).replace(/```json|```/g, '').trim(),
      );
    } catch (err) {
      this.logger.error('Image extraction failed', err);
      return {
        fecha: new Date().toISOString().split('T')[0],
        proveedor: '',
        categoria: 'Other',
        descripcion: '',
        monto: 0,
      };
    }
  }

  async classifyIntent(text: string): Promise<string> {
    try {
      const res = await this.model.invoke([
        new HumanMessage({
          content: `Classify this message from a climbing gym expense bot user.
Reply with ONLY one word: MANUAL_EXPENSE | QUERY_EXPENSES | MONTHLY_SUMMARY | GREETING | UNKNOWN

Message: "${text}"`,
        }),
      ]);
      return (res.content as string).trim();
    } catch {
      return 'UNKNOWN';
    }
  }
}
