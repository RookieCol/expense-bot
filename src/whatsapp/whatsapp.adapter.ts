import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import type {
  MessagingPort,
  MenuSection,
  SentMessage,
} from '../shared/messaging/messaging-port.interface';

@Injectable()
export class WhatsAppAdapter implements MessagingPort, OnModuleInit {
  private readonly logger = new Logger(WhatsAppAdapter.name);
  private client!: ReturnType<typeof Twilio>;
  private fromNumber!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID')!;
    const authToken  = this.config.get<string>('TWILIO_AUTH_TOKEN')!;
    this.fromNumber  = this.config.get<string>('TWILIO_WHATSAPP_NUMBER')!;
    this.client = Twilio(accountSid, authToken);
  }

  async sendText(
    chatId: string,
    text: string,
    _opts?: { parseMode?: 'MarkdownV2' | 'HTML' },
  ): Promise<SentMessage> {
    const msg = await this.client.messages.create({
      from: this.fromNumber,
      to: `whatsapp:${chatId}`,
      body: this.stripMarkdown(text),
    });
    return { messageId: msg.sid };
  }

  async editText(
    chatId: string,
    _messageId: string,
    text: string,
    opts?: { parseMode?: 'MarkdownV2' | 'HTML' },
  ): Promise<SentMessage> {
    return this.sendText(chatId, text, opts);
  }

  async deleteMessage(_chatId: string, _messageId: string): Promise<void> {
    // WhatsApp does not support deleting messages sent by the bot
  }

  async sendMenu(chatId: string, text: string, sections: MenuSection[]): Promise<SentMessage> {
    const interactiveData = {
      type: 'list',
      body: { text: this.stripMarkdown(text) },
      action: {
        button: 'Seleccionar',
        sections: sections.map((s) => ({
          title: (s.title || 'Opciones').substring(0, 24),
          rows: s.options.slice(0, 10).map((o) => ({
            id: o.id.substring(0, 256),
            title: o.label.substring(0, 24),
            description: (o.description ?? '').substring(0, 72),
          })),
        })),
      },
    };

    try {
      const msg = await (this.client.messages.create as (params: Record<string, unknown>) => Promise<{ sid: string }>)({
        from: this.fromNumber,
        to: `whatsapp:${chatId}`,
        body: this.stripMarkdown(text),
        interactiveData: JSON.stringify(interactiveData),
      });
      return { messageId: msg.sid };
    } catch (err) {
      this.logger.warn('Interactive list failed, falling back to numbered text', err);
      return this.sendNumberedMenu(chatId, text, sections);
    }
  }

  async sendPhoto(chatId: string, url: string, caption?: string): Promise<SentMessage> {
    const msg = await this.client.messages.create({
      from: this.fromNumber,
      to: `whatsapp:${chatId}`,
      body: caption ? this.stripMarkdown(caption) : '',
      mediaUrl: [url],
    });
    return { messageId: msg.sid };
  }

  private async sendNumberedMenu(chatId: string, text: string, sections: MenuSection[]): Promise<SentMessage> {
    const allOptions = sections.flatMap((s) => s.options);
    const lines = [this.stripMarkdown(text), ''];
    allOptions.forEach((o, i) => lines.push(`${i + 1}. ${o.label}`));
    return this.sendText(chatId, lines.join('\n'));
  }

  private stripMarkdown(text: string): string {
    return text
      .replace(/\\([_*[\]()~`>#+=|{}.!\\-])/g, '$1') // unescape MarkdownV2
      .replace(/[*_~`]/g, '');                          // strip remaining formatting chars
  }
}
