import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import type {
  MessagingPort,
  MenuSection,
  SentMessage,
} from '../shared/messaging/messaging-port.interface';
import { ConversationService } from '../conversation/conversation.service';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import type { MenuType } from './whatsapp-templates';

@Injectable()
export class WhatsAppAdapter implements MessagingPort, OnModuleInit {
  private readonly logger = new Logger(WhatsAppAdapter.name);
  private client!: ReturnType<typeof Twilio>;
  private fromNumber!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly conversation: ConversationService,
    private readonly templates: WhatsAppTemplateService,
  ) {}

  onModuleInit(): void {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID')!;
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN')!;
    this.fromNumber = this.config.get<string>('TWILIO_WHATSAPP_NUMBER')!;
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

  async sendMenu(
    chatId: string,
    text: string,
    sections: MenuSection[],
    menuType?: string,
  ): Promise<SentMessage> {
    const allOptions = sections.flatMap((s) => s.options);
    const plainText = this.stripMarkdown(text);

    const contentSid = menuType
      ? this.templates.getSid(menuType as MenuType)
      : undefined;
    if (contentSid) {
      try {
        const msg = await (
          this.client.messages.create as unknown as (
            params: Record<string, unknown>,
          ) => Promise<{ sid: string }>
        )({
          from: this.fromNumber,
          to: `whatsapp:${chatId}`,
          contentSid,
          contentVariables: JSON.stringify({
            '1': plainText.substring(0, 1024),
          }),
        });
        this.conversation.setPendingMenuOptions(
          chatId,
          allOptions.map((o) => o.id),
        );
        return { messageId: msg.sid };
      } catch (err) {
        this.logger.warn(
          `Template ${menuType} send failed, falling back to numbered text`,
          err,
        );
      }
    }

    // Fallback: numbered text
    const lines = [plainText, ''];
    allOptions.forEach((o, i) => lines.push(`${i + 1}. ${o.label}`));
    lines.push('', 'Responde con el número de la opción.');
    const result = await this.sendText(chatId, lines.join('\n'));
    this.conversation.setPendingMenuOptions(
      chatId,
      allOptions.map((o) => o.id),
    );
    return result;
  }

  async sendPhoto(
    chatId: string,
    url: string,
    caption?: string,
  ): Promise<SentMessage> {
    const msg = await this.client.messages.create({
      from: this.fromNumber,
      to: `whatsapp:${chatId}`,
      body: caption ? this.stripMarkdown(caption) : '',
      mediaUrl: [url],
    });
    return { messageId: msg.sid };
  }

  private stripMarkdown(text: string): string {
    return text.replace(/\\([_*[\]()~`>#+=|{}.!\\-])/g, '$1');
  }
}
