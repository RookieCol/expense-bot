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
      {
        inlineData: { mimeType: 'image/jpeg', data: buffer.toString('base64') },
      },
      IMAGE_PROMPT,
    ]);
    const text = result.response
      .text()
      .replace(/```json|```/g, '')
      .trim();
    return JSON.parse(text) as Partial<Expense>;
  }

  async classifyIntent(text: string): Promise<string> {
    const model = this.genai.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(INTENT_PROMPT(text));
    return result.response.text().trim();
  }

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
}
