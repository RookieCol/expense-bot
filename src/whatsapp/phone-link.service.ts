import { Injectable } from '@nestjs/common';

@Injectable()
export class PhoneLinkService {
  /** phone (normalized) → telegramChatId */
  private readonly links = new Map<string, string>();

  private normalize(phone: string): string {
    // Keep leading + and digits only
    const digits = phone.replace(/[^\d+]/g, '');
    return digits.startsWith('+') ? digits : `+${digits}`;
  }

  link(telegramChatId: string, phone: string): void {
    this.links.set(this.normalize(phone), telegramChatId);
  }

  /** Returns telegramChatId if phone is linked, otherwise returns phone as-is */
  resolveToCanonical(phone: string): string {
    return this.links.get(this.normalize(phone)) ?? phone;
  }
}
