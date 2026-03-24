import { Injectable, Logger, Inject } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { BOT } from './bot.provider';
import { ConversationService } from '../conversation/conversation.service';
import { ConversationState } from '../conversation/conversation-state.enum';
import { AiService } from '../ai/ai.service';
import { I18nService } from '../i18n/i18n.service';
import { MenuHandler } from './handlers/menu.handler';
import { ExpenseHandler } from './handlers/expense.handler';
import { ReceiptHandler } from './handlers/receipt.handler';
import { QueryHandler } from './handlers/query.handler';

const EXPENSE_STATES = new Set([
  ConversationState.WAITING_AMOUNT,
  ConversationState.WAITING_PROVIDER,
  ConversationState.WAITING_CATEGORY, // text ignored — user must tap keyboard
  ConversationState.WAITING_DESCRIPTION,
  ConversationState.WAITING_RECEIPT, // text ignored — user must send a photo
  ConversationState.WAITING_VOICE_EXPENSE, // text ignored — user must send a voice note
  ConversationState.WAITING_CONFIRMATION,
  ConversationState.EDITING_FIELD,
]);

@Injectable()
export class TelegramDispatcher {
  private readonly logger = new Logger(TelegramDispatcher.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly conversation: ConversationService,
    private readonly ai: AiService,
    private readonly i18n: I18nService,
    private readonly menu: MenuHandler,
    private readonly expense: ExpenseHandler,
    private readonly receipt: ReceiptHandler,
    private readonly query: QueryHandler,
  ) {}

  async dispatchMessage(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    if (msg.from) {
      const name = msg.from.username
        ? `@${msg.from.username}`
        : msg.from.first_name;
      this.conversation.setUserName(chatId, name);
    }
    if (msg.message_id) {
      this.conversation.addUserMessageId(chatId, msg.message_id);
    }

    if (msg.photo) {
      try {
        return await this.receipt.handlePhoto(msg);
      } catch (err) {
        this.logger.error(`AI dispatch failed for chat ${chatId}`, err);
        this.conversation.reset(chatId);
        await this.bot.sendMessage(chatId, '⚠️ Ocurrió un error. Por favor intenta de nuevo o usa /cancel.');
        return;
      }
    }

    const text = msg.text?.trim() ?? '';

    // Named commands
    if (/^\/start/.test(text)) return this.menu.showMenu(chatId);
    if (/^\/(cancel|cancelar)/.test(text))
      return this.menu.handleCancel(chatId);
    if (/^\/(gastos|expenses)/.test(text))
      return this.query.handleRecentExpenses(chatId);
    if (/^\/(mes|month)/.test(text))
      return this.query.handleMonthlySummary(chatId);
    if (/^\/(gasto|expense)/.test(text))
      return this.menu.startExpenseFlow(chatId);
    if (text.startsWith('/')) return; // ignore unknown commands

    return this.dispatchTextInput(chatId, text);
  }

  /** Called when a voice note is received */
  async dispatchVoice(chatId: number, buffer: Buffer): Promise<void> {
    const processing = await this.bot.sendMessage(
      chatId,
      this.i18n.get('general.processing'),
      { parse_mode: 'MarkdownV2' },
    );
    try {
      const text = await this.ai.transcribeAudio(buffer);
      await this.bot.deleteMessage(chatId, processing.message_id);
      if (!text) {
        return this.menu.handleUnknown(chatId);
      }
      const ctx = this.conversation.getContext(chatId);
      const extractStates = new Set([
        ConversationState.WAITING_VOICE_EXPENSE,
        ConversationState.IDLE,
      ]);
      if (extractStates.has(ctx.state)) {
        const extracted = await this.ai.extractFromText(text);
        if (!extracted.fecha) {
          extracted.fecha = new Date().toISOString().split('T')[0];
        }
        this.conversation.reset(chatId);
        this.conversation.updatePending(chatId, extracted);
        this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
        return this.expense.showConfirmation(chatId);
      }
      return this.dispatchTextInput(chatId, text);
    } catch (err) {
      this.logger.error(`AI dispatch failed for chat ${chatId}`, err);
      this.conversation.reset(chatId);
      await this.bot.sendMessage(chatId, '⚠️ Ocurrió un error. Por favor intenta de nuevo o usa /cancel.');
    }
  }

  async dispatchCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message!.chat.id;
    if (query.from) {
      const name = query.from.username
        ? `@${query.from.username}`
        : query.from.first_name;
      this.conversation.setUserName(chatId, name);
    }
    const data = query.data ?? '';

    if (data === 'cmd_gasto')   return this.menu.showExpenseMethodMenu(chatId);
    if (data === 'cmd_gastos')  return this.query.handleRecentExpenses(chatId);
    if (data === 'cmd_mes')     return this.query.handleMonthlySummary(chatId);
    if (data === 'back_menu')   return this.menu.showMenu(chatId);
    if (data === 'confirm_yes') return this.expense.handleConfirmSave(chatId);
    if (data === 'confirm_no')  return this.menu.handleCancel(chatId);

    if (data === 'method_receipt') return this.menu.startReceiptFlow(chatId);
    if (data === 'method_dictate') return this.menu.startDictateFlow(chatId);
    if (data === 'method_manual')  return this.menu.startExpenseFlow(chatId);

    if (data.startsWith('cat_'))
      return this.expense.handleCategorySelected(chatId, data.replace('cat_', ''));
    if (data.startsWith('desc_'))
      return this.expense.handleDescriptionSelected(chatId, data.replace('desc_', ''));

    // IMPORTANT: edit_menu check MUST come before startsWith('edit_') — 'edit_menu'.startsWith('edit_') is true
    if (data === 'edit_menu')
      return this.expense.showEditMenu(chatId);
    if (data.startsWith('edit_'))
      return this.expense.handleEditField(chatId, data.replace('edit_', ''));

    this.logger.warn(`Unknown callback data: ${data}`);
  }

  private async dispatchTextInput(chatId: number, text: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);

    if (EXPENSE_STATES.has(ctx.state)) {
      return this.expense.handleText(chatId, text);
    }

    try {
      // NLP for free text in IDLE
      const intent = await this.ai.classifyIntent(text);
      if (intent === 'MANUAL_EXPENSE') return this.menu.startExpenseFlow(chatId);
      if (intent === 'QUERY_EXPENSES')
        return this.query.handleRecentExpenses(chatId);
      if (intent === 'MONTHLY_SUMMARY')
        return this.query.handleMonthlySummary(chatId);
      if (intent === 'GREETING') return this.menu.showMenu(chatId);

      return this.menu.handleUnknown(chatId);
    } catch (err) {
      this.logger.error(`AI dispatch failed for chat ${chatId}`, err);
      this.conversation.reset(chatId);
      await this.bot.sendMessage(chatId, '⚠️ Ocurrió un error. Por favor intenta de nuevo o usa /cancel.');
    }
  }
}
