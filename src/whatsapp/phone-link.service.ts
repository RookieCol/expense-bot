import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from '@upstash/redis';
import { REDIS_CLIENT } from '../shared/redis/redis.provider';

/**
 * Persistent mapping of WhatsApp phone number → Telegram chatId, so a
 * user who linked via /vincular keeps the same conversation context
 * across both channels even after server restarts.
 *
 * Phone numbers are stored normalized (leading + and digits only).
 * No TTL — links are durable until explicitly unlinked.
 */
@Injectable()
export class PhoneLinkService {
  private readonly logger = new Logger(PhoneLinkService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private normalize(phone: string): string {
    const digits = phone.replace(/[^\d+]/g, '');
    return digits.startsWith('+') ? digits : `+${digits}`;
  }

  private key(phone: string): string {
    return `phone:${this.normalize(phone)}`;
  }

  async link(telegramChatId: string, phone: string): Promise<void> {
    try {
      await this.redis.set(this.key(phone), telegramChatId);
    } catch (err) {
      this.logger.warn(
        `Redis link failed for ${phone}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Returns the linked Telegram chatId when one exists, otherwise the
   * normalized phone itself so the caller can use it as a first-class
   * chatId for WhatsApp-only users.
   */
  async resolveToCanonical(phone: string): Promise<string> {
    const normalized = this.normalize(phone);
    try {
      const linked = await this.redis.get<string>(this.key(phone));
      return linked ?? normalized;
    } catch (err) {
      this.logger.warn(
        `Redis resolve failed for ${phone}, using phone as-is: ${(err as Error).message}`,
      );
      return normalized;
    }
  }
}
