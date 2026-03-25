import { Injectable, Inject, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { BOT } from '../bot.provider';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { I18nService } from '../../i18n/i18n.service';
import { StepMessenger } from '../step-messenger.service';

@Injectable()
export class MenuHandler {
  private readonly logger = new Logger(MenuHandler.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly conversation: ConversationService,
    private readonly i18n: I18nService,
    private readonly step: StepMessenger,
  ) {}

  async showMenu(chatId: number): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const toDelete = [
      ctx.lastBotMessageId,
      ctx.editStepMessageId,
      ...(ctx.manualStepIds ?? []),
      ...(ctx.userMessageIds ?? []),
    ].filter(Boolean) as number[];
    this.conversation.reset(chatId);
    const msg = await this.bot.sendMessage(chatId, this.i18n.get('menu.welcome'), {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [{ text: this.i18n.get('menu.btn_log_expense'), callback_data: 'cmd_gasto' }],
          [
            { text: this.i18n.get('menu.btn_recent'), callback_data: 'cmd_gastos' },
            { text: this.i18n.get('menu.btn_summary'), callback_data: 'cmd_mes' },
          ],
        ],
      },
    });
    await Promise.all(toDelete.map((id) => this.bot.deleteMessage(chatId, id).catch(() => {})));
    this.conversation.setLastBotMessageId(chatId, msg.message_id);
  }

  async startExpenseFlow(chatId: number): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_AMOUNT);
    const msg = await this.bot.sendMessage(chatId, this.i18n.get('expense.ask_amount'), {
      parse_mode: 'MarkdownV2',
    });
    this.conversation.addManualStepId(chatId, msg.message_id);
  }

  async startReceiptFlow(chatId: number): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_RECEIPT);
    await this.step.send(chatId, this.i18n.get('receipt.ask'), {
      parse_mode: 'MarkdownV2',
    });
  }

  async showExpenseMethodMenu(chatId: number): Promise<void> {
    await this.step.send(chatId, this.i18n.get('menu.expense_method_prompt'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: this.i18n.get('menu.btn_receipt'), callback_data: 'method_receipt' }],
          [{ text: this.i18n.get('menu.btn_dictate'), callback_data: 'method_dictate' }],
          [{ text: this.i18n.get('menu.btn_manual'),  callback_data: 'method_manual'  }],
          [{ text: this.i18n.get('general.back_to_menu'), callback_data: 'back_menu' }],
        ],
      },
    });
  }

  async startDictateFlow(chatId: number): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_VOICE_EXPENSE);
    await this.step.send(chatId, this.i18n.get('expense.dictate_ask'), {
      parse_mode: 'MarkdownV2',
    });
  }

  async handleCancel(chatId: number): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const toDelete = [
      ctx.lastBotMessageId,
      ctx.editStepMessageId,
      ...(ctx.manualStepIds ?? []),
      ...(ctx.userMessageIds ?? []),
    ].filter(Boolean) as number[];
    this.conversation.reset(chatId);
    const msg = await this.bot.sendMessage(chatId, this.i18n.get('general.cancelled'), {
      parse_mode: 'MarkdownV2',
    });
    await Promise.all(toDelete.map((id) => this.bot.deleteMessage(chatId, id).catch(() => {})));
    this.conversation.setLastBotMessageId(chatId, msg.message_id);
  }

  async handleUnknown(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, this.i18n.get('nlp.unknown'), {
      parse_mode: 'MarkdownV2',
    });
  }
}
