import { Injectable, Logger, Inject } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import type { MessagingPort } from '../shared/messaging/messaging-port.interface';
import { MESSAGING_PORT } from '../shared/messaging/messaging-port.interface';
import { ConversationService } from '../conversation/conversation.service';
import { ConversationState } from '../conversation/conversation-state.enum';
import { AiService } from '../ai/ai.service';
import { I18nService } from '../i18n/i18n.service';
import { MenuHandler } from './handlers/menu.handler';
import { ExpenseHandler } from './handlers/expense.handler';
import { ReceiptHandler } from './handlers/receipt.handler';
import { QueryHandler } from './handlers/query.handler';
import { PhoneLinkService } from '../whatsapp/phone-link.service';

const EXPENSE_STATES = new Set([
  ConversationState.WAITING_AMOUNT,
  ConversationState.WAITING_PROVIDER,
  ConversationState.WAITING_CATEGORY,
  ConversationState.WAITING_DESCRIPTION,
  ConversationState.WAITING_RECEIPT,
  ConversationState.WAITING_VOICE_EXPENSE,
  ConversationState.WAITING_CONFIRMATION,
  ConversationState.EDITING_FIELD,
]);

@Injectable()
export class TelegramDispatcher {
  private readonly logger = new Logger(TelegramDispatcher.name);

  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
    private readonly ai: AiService,
    private readonly i18n: I18nService,
    private readonly menu: MenuHandler,
    private readonly expense: ExpenseHandler,
    private readonly receipt: ReceiptHandler,
    private readonly query: QueryHandler,
    private readonly phoneLink: PhoneLinkService,
  ) {}

  async dispatchMessage(msg: TelegramBot.Message): Promise<void> {
    const chatId = String(msg.chat.id);
    if (msg.from) {
      const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
      this.conversation.setUserName(chatId, name);
    }
    if (msg.message_id) {
      this.conversation.addUserMessageId(chatId, String(msg.message_id));
    }

    // Contact share — /vincular flow
    if (msg.contact && msg.contact.phone_number) {
      const phone = msg.contact.phone_number.replace(/\D/g, '');
      await this.phoneLink.link(chatId, `+${phone}`);
      await this.messaging.sendText(
        chatId,
        '✅ ¡Cuenta vinculada! Ya puedes usar el bot desde WhatsApp también.',
      );
      return;
    }

    if (msg.photo) {
      // Photo download is handled by TelegramService which calls receipt.handlePhotoBuffer
      return;
    }

    const text = msg.text?.trim() ?? '';

    if (/^\/start/.test(text)) return this.menu.showMenu(chatId);
    if (/^\/(cancel|cancelar)/.test(text)) return this.menu.handleCancel(chatId);
    if (/^\/(gastos|expenses)/.test(text)) return this.query.handleRecentExpenses(chatId);
    if (/^\/(mes|month)/.test(text)) return this.query.handleMonthlySummary(chatId);
    if (/^\/(gasto|expense)/.test(text)) return this.menu.startExpenseFlow(chatId);
    if (/^\/vincular/.test(text)) return this.menu.showVincularPrompt(chatId);
    if (text.startsWith('/')) return;

    return this.dispatchTextInput(chatId, text);
  }

  async dispatchVoice(chatId: string, buffer: Buffer, voiceMessageId?: string): Promise<void> {
    const processingMsg = await this.messaging.sendText(
      chatId,
      this.i18n.get('general.processing'),
      { parseMode: 'MarkdownV2' },
    );
    try {
      const text = await this.ai.transcribeAudio(buffer);
      await this.messaging.deleteMessage(chatId, processingMsg.messageId);
      if (!text) return this.menu.handleUnknown(chatId);
      const ctx = this.conversation.getContext(chatId);
      const extractStates = new Set([ConversationState.WAITING_VOICE_EXPENSE, ConversationState.IDLE]);
      if (extractStates.has(ctx.state)) {
        const extracted = await this.ai.extractFromText(text);
        if (!extracted.fecha) extracted.fecha = new Date().toISOString().split('T')[0];
        this.conversation.reset(chatId);
        if (voiceMessageId) this.conversation.addUserMessageId(chatId, voiceMessageId);
        this.conversation.updatePending(chatId, extracted);
        this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
        return this.expense.showConfirmation(chatId);
      }
      return this.dispatchTextInput(chatId, text);
    } catch (err) {
      this.logger.error(`AI dispatch failed for chat ${chatId}`, err);
      this.conversation.reset(chatId);
      await this.messaging.sendText(chatId, '⚠️ Ocurrió un error. Por favor intenta de nuevo o usa /cancel.');
    }
  }

  async dispatchCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = String(query.message!.chat.id);
    if (query.from) {
      const name = query.from.username ? `@${query.from.username}` : query.from.first_name;
      this.conversation.setUserName(chatId, name);
    }
    return this.routeCallbackData(chatId, query.data ?? '');
  }

  /** Shared callback routing — used by both Telegram and WhatsApp dispatchers */
  async routeCallbackData(chatId: string, data: string): Promise<void> {
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
    if (data === 'edit_menu')   return this.expense.showEditMenu(chatId);
    if (data.startsWith('edit_'))
      return this.expense.handleEditField(chatId, data.replace('edit_', ''));
    this.logger.warn(`Unknown callback data: ${data}`);
  }

  private async dispatchTextInput(chatId: string, text: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    if (EXPENSE_STATES.has(ctx.state)) return this.expense.handleText(chatId, text);
    try {
      const intent = await this.ai.classifyIntent(text);
      if (intent === 'MANUAL_EXPENSE') return this.menu.startExpenseFlow(chatId);
      if (intent === 'QUERY_EXPENSES') return this.query.handleRecentExpenses(chatId);
      if (intent === 'MONTHLY_SUMMARY') return this.query.handleMonthlySummary(chatId);
      if (intent === 'GREETING') return this.menu.showMenu(chatId);
      return this.menu.handleUnknown(chatId);
    } catch (err) {
      this.logger.error(`AI dispatch failed for chat ${chatId}`, err);
      this.conversation.reset(chatId);
      await this.messaging.sendText(chatId, '⚠️ Ocurrió un error. Por favor intenta de nuevo o usa /cancel.');
    }
  }
}
