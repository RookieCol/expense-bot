import { Injectable, Logger, Inject } from '@nestjs/common';
import { IAiConnector } from './connectors/ai-connector.interface';
import { Expense } from '../shared/interfaces/expense.interface';

export const AI_CONNECTORS = 'AI_CONNECTORS';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(AI_CONNECTORS) private readonly connectors: IAiConnector[],
  ) {}

  async extractFromImage(buffer: Buffer): Promise<Partial<Expense>> {
    for (const connector of this.connectors) {
      try {
        return await connector.extractFromImage(buffer);
      } catch (err) {
        this.logger.warn(
          `[AI] ${connector.name} failed: ${(err as Error).message}`,
        );
      }
    }
    // Safe default — conversation continues, user fills fields manually
    return {
      fecha: new Date().toISOString().split('T')[0],
      proveedor: '',
      categoria: 'Other',
      descripcion: '',
      monto: 0,
    };
  }

  async classifyIntent(text: string): Promise<string> {
    for (const connector of this.connectors) {
      try {
        return await connector.classifyIntent(text);
      } catch (err) {
        this.logger.warn(
          `[AI] ${connector.name} failed: ${(err as Error).message}`,
        );
      }
    }
    return 'UNKNOWN';
  }

  async transcribeAudio(buffer: Buffer): Promise<string> {
    for (const connector of this.connectors) {
      try {
        return await connector.transcribeAudio(buffer);
      } catch (err) {
        this.logger.warn(
          `[AI] ${connector.name} transcription failed: ${(err as Error).message}`,
        );
      }
    }
    return ''; // safe default — empty string treated as unknown intent
  }
}
