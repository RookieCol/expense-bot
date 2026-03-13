import { Injectable, Inject, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { BOT } from '../bot.provider';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { AiService } from '../../ai/ai.service';
import { I18nService } from '../../i18n/i18n.service';
import { ExpenseHandler } from './expense.handler';

@Injectable()
export class ReceiptHandler {
  private readonly logger = new Logger(ReceiptHandler.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly conversation: ConversationService,
    private readonly ai: AiService,
    private readonly i18n: I18nService,
    private readonly expenseHandler: ExpenseHandler,
  ) {}

  async handlePhoto(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    this.conversation.setState(chatId, ConversationState.WAITING_RECEIPT);

    const processing = await this.bot.sendMessage(
      chatId,
      this.i18n.get('receipt.processing'),
      { parse_mode: 'MarkdownV2' },
    );

    try {
      const photo = msg.photo![msg.photo!.length - 1];
      const fileLink = await this.bot.getFileLink(photo.file_id);
      const res = await axios.get(fileLink, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(res.data as ArrayBuffer);

      this.conversation.setImageBuffer(chatId, buffer);
      const extracted = await this.ai.extractFromImage(buffer);
      if (!extracted.fecha) {
        extracted.fecha = new Date().toISOString().split('T')[0];
      }

      this.conversation.updatePending(chatId, extracted);
      this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);

      try {
        await this.bot.deleteMessage(chatId, processing.message_id);
      } catch {
        // ignore delete errors
      }

      await this.expenseHandler.showConfirmation(chatId);
    } catch (err) {
      this.logger.error('Photo handling error', err);
      await this.bot.sendMessage(chatId, this.i18n.get('receipt.error'), {
        parse_mode: 'MarkdownV2',
      });
    }
  }
}
