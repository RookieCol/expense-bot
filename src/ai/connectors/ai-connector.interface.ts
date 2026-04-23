import { Expense } from '../../shared/interfaces/expense.interface';

export interface IAiConnector {
  readonly name: string;
  extractFromImage(buffer: Buffer, chatId?: string): Promise<Partial<Expense>>;
  extractFromText(text: string, chatId?: string): Promise<Partial<Expense>>;
  classifyIntent(text: string, chatId?: string): Promise<string>;
  transcribeAudio(buffer: Buffer, chatId?: string): Promise<string>;
}
