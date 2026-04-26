import { Injectable, Inject, Logger } from '@nestjs/common';
import type { MessagingPort } from '../../shared/messaging/messaging-port.interface';
import { MESSAGING_PORT } from '../../shared/messaging/messaging-port.interface';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { AiService } from '../../ai/ai.service';
import { I18nService } from '../../i18n/i18n.service';
import { ExpenseHandler } from './expense.handler';

@Injectable()
export class ReceiptHandler {
  private readonly logger = new Logger(ReceiptHandler.name);

  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
    private readonly ai: AiService,
    private readonly i18n: I18nService,
    private readonly expenseHandler: ExpenseHandler,
  ) {}

  /** Platform-agnostic entry point — both Telegram and WhatsApp dispatchers call this */
  async handlePhotoBuffer(chatId: string, buffer: Buffer): Promise<void> {
    this.conversation.setState(chatId, ConversationState.WAITING_RECEIPT);
    const processingMsg = await this.messaging.sendText(
      chatId,
      this.i18n.get('receipt.processing'),
      { parseMode: 'MarkdownV2' },
    );
    try {
      this.conversation.setImageBuffer(chatId, buffer);
      const extracted = await this.ai.extractFromImage(buffer, chatId);
      if (!extracted.date) {
        extracted.date = new Date().toISOString().split('T')[0];
      }
      this.conversation.updatePending(chatId, extracted);
      this.conversation.setState(
        chatId,
        ConversationState.WAITING_CONFIRMATION,
      );
      await this.messaging.deleteMessage(chatId, processingMsg.messageId);
      await this.expenseHandler.showConfirmation(chatId);
    } catch (err) {
      this.logger.error('Photo handling error', err);
      // Clean up the "⏳ Leyendo tu recibo..." message and reset state so
      // the user can try again from a blank slate.
      await this.messaging.deleteMessage(chatId, processingMsg.messageId);
      this.conversation.reset(chatId);
      await this.messaging.sendText(chatId, this.i18n.get('receipt.error'), {
        parseMode: 'MarkdownV2',
      });
    }
  }
}
