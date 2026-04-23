import { Injectable, Logger, Inject } from '@nestjs/common';
import { IAiConnector } from './connectors/ai-connector.interface';
import { Expense } from '../shared/interfaces/expense.interface';
import { AiUnavailableError } from './errors/ai-unavailable.error';

export const AI_CONNECTORS = 'AI_CONNECTORS';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(AI_CONNECTORS) private readonly connectors: IAiConnector[],
  ) {}

  async extractFromImage(buffer: Buffer): Promise<Partial<Expense>> {
    let lastError: Error | undefined;
    for (const connector of this.connectors) {
      try {
        return await connector.extractFromImage(buffer);
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(`[AI] ${connector.name} failed: ${lastError.message}`);
      }
    }
    throw new AiUnavailableError('extract-image', lastError);
  }

  async extractFromText(text: string): Promise<Partial<Expense>> {
    let lastError: Error | undefined;
    for (const connector of this.connectors) {
      try {
        return await connector.extractFromText(text);
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(
          `[AI] ${connector.name} extractFromText failed: ${lastError.message}`,
        );
      }
    }
    throw new AiUnavailableError('extract-text', lastError);
  }

  /**
   * Intent classification is an optional optimization — the bot still
   * works if it returns 'UNKNOWN' (user just sees the "didn't
   * understand" menu). Keep the silent fallback here so a flaky AI
   * doesn't break the main flow.
   */
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
    let lastError: Error | undefined;
    for (const connector of this.connectors) {
      try {
        return await connector.transcribeAudio(buffer);
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(
          `[AI] ${connector.name} transcription failed: ${lastError.message}`,
        );
      }
    }
    throw new AiUnavailableError('transcribe-audio', lastError);
  }
}
