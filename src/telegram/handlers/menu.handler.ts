import { Injectable, Inject, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { BOT } from '../bot.provider';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { I18nService } from '../../i18n/i18n.service';

@Injectable()
export class MenuHandler {
  private readonly logger = new Logger(MenuHandler.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly conversation: ConversationService,
    private readonly i18n: I18nService,
  ) {}

  async showMenu(chatId: number): Promise<void> {
    this.conversation.reset(chatId);
    await this.bot.sendMessage(chatId, this.i18n.get('menu.welcome'), {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: this.i18n.get('menu.btn_log_expense'),
              callback_data: 'cmd_gasto',
            },
            {
              text: this.i18n.get('menu.btn_upload_receipt'),
              callback_data: 'cmd_factura',
            },
          ],
          [
            {
              text: this.i18n.get('menu.btn_recent'),
              callback_data: 'cmd_gastos',
            },
            {
              text: this.i18n.get('menu.btn_summary'),
              callback_data: 'cmd_mes',
            },
          ],
        ],
      },
    });
  }

  async startExpenseFlow(chatId: number): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_AMOUNT);
    await this.bot.sendMessage(chatId, this.i18n.get('expense.ask_amount'), {
      parse_mode: 'MarkdownV2',
    });
  }

  async startReceiptFlow(chatId: number): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_RECEIPT);
    await this.bot.sendMessage(chatId, this.i18n.get('receipt.ask'), {
      parse_mode: 'MarkdownV2',
    });
  }

  async handleCancel(chatId: number): Promise<void> {
    this.conversation.reset(chatId);
    await this.bot.sendMessage(chatId, this.i18n.get('general.cancelled'), {
      parse_mode: 'MarkdownV2',
    });
    setTimeout(() => this.showMenu(chatId), 1000);
  }

  async handleUnknown(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, this.i18n.get('nlp.unknown'), {
      parse_mode: 'MarkdownV2',
    });
  }
}
