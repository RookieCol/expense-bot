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
import { InsightsHandler } from './handlers/insights.handler';
import { PhoneLinkService } from '../whatsapp/phone-link.service';
import { ConversationAgent } from '../ai/agents/conversation.agent';

const EXPENSE_STATES = new Set([
  ConversationState.WAITING_AMOUNT,
  ConversationState.WAITING_PROVIDER,
  ConversationState.WAITING_CATEGORY,
  ConversationState.WAITING_REASON,
  ConversationState.WAITING_RECEIPT,
  ConversationState.WAITING_VOICE_EXPENSE,
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
    private readonly insights: InsightsHandler,
    private readonly phoneLink: PhoneLinkService,
    private readonly agent: ConversationAgent,
  ) {}

  async dispatchMessage(msg: TelegramBot.Message): Promise<void> {
    const chatId = String(msg.chat.id);
    await this.conversation.load(chatId);
    try {
      if (msg.from) {
        const name = msg.from.username
          ? `@${msg.from.username}`
          : msg.from.first_name;
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
      if (/^\/(cancel|cancelar)/.test(text))
        return this.menu.handleCancel(chatId);
      if (/^\/(gastos|expenses)/.test(text))
        return this.query.handleRecentExpenses(chatId);
      if (/^\/(mes|month)/.test(text))
        return this.query.handleMonthlySummary(chatId);
      if (/^\/(gasto|expense)/.test(text))
        return this.menu.startExpenseFlow(chatId);
      if (/^\/vincular/.test(text)) return this.menu.showVincularPrompt(chatId);
      if (text.startsWith('/')) return;

      return this.dispatchTextInput(chatId, text);
    } finally {
      await this.conversation.flush(chatId);
    }
  }

  async dispatchVoice(
    chatId: string,
    buffer: Buffer,
    voiceMessageId?: string,
  ): Promise<void> {
    await this.conversation.load(chatId);
    const processingMsg = await this.messaging.sendText(
      chatId,
      this.i18n.get('general.processing'),
      { parseMode: 'MarkdownV2' },
    );
    try {
      const text = await this.ai.transcribeAudio(buffer, chatId);
      await this.messaging.deleteMessage(chatId, processingMsg.messageId);
      if (!text) return this.menu.handleUnknown(chatId);
      const ctx = this.conversation.getContext(chatId);
      const extractStates = new Set([
        ConversationState.WAITING_VOICE_EXPENSE,
        ConversationState.IDLE,
      ]);
      if (extractStates.has(ctx.state)) {
        const extracted = await this.ai.extractFromText(text, chatId);
        if (!extracted.date)
          extracted.date = new Date().toISOString().split('T')[0];
        this.conversation.reset(chatId);
        if (voiceMessageId)
          this.conversation.addUserMessageId(chatId, voiceMessageId);
        this.conversation.updatePending(chatId, extracted);
        this.conversation.setState(
          chatId,
          ConversationState.WAITING_CONFIRMATION,
        );
        return this.expense.showConfirmation(chatId);
      }
      return this.dispatchTextInput(chatId, text);
    } catch (err) {
      this.logger.error(`AI dispatch failed for chat ${chatId}`, err);
      this.conversation.reset(chatId);
      await this.messaging.sendText(
        chatId,
        '⚠️ Ocurrió un error. Por favor intenta de nuevo o usa /cancel.',
      );
    } finally {
      await this.conversation.flush(chatId);
    }
  }

  async dispatchCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = String(query.message!.chat.id);
    await this.conversation.load(chatId);
    try {
      if (query.from) {
        const name = query.from.username
          ? `@${query.from.username}`
          : query.from.first_name;
        this.conversation.setUserName(chatId, name);
      }
      return await this.routeCallbackData(chatId, query.data ?? '');
    } finally {
      await this.conversation.flush(chatId);
    }
  }

  /** Shared callback routing — used by both Telegram and WhatsApp dispatchers */
  async routeCallbackData(chatId: string, data: string): Promise<void> {
    if (data === 'cmd_gasto') return this.menu.showExpenseMethodMenu(chatId);
    if (data === 'cmd_gastos') return this.query.handleRecentExpenses(chatId);
    if (data === 'cmd_mes') return this.query.handleMonthlySummary(chatId);
    if (data === 'cmd_insights') return this.insights.start(chatId);
    if (data === 'back_menu') return this.menu.showMenu(chatId);
    if (data === 'confirm_yes') return this.expense.handleConfirmSave(chatId);
    if (data === 'confirm_no') return this.menu.handleCancel(chatId);
    if (data === 'method_receipt') return this.menu.startReceiptFlow(chatId);
    if (data === 'method_dictate') return this.menu.startDictateFlow(chatId);
    if (data === 'method_manual') return this.menu.startExpenseFlow(chatId);
    if (data.startsWith('cat_'))
      return this.expense.handleCategorySelected(chatId, data.replace('cat_', ''));
    if (data.startsWith('met_'))
      return this.expense.handleMethodSelected(chatId, data.replace('met_', ''));
    if (data === 'edit_menu') return this.expense.showEditMenu(chatId);
    if (data.startsWith('edit_'))
      return this.expense.handleEditField(chatId, data.replace('edit_', ''));
    this.logger.warn(`Unknown callback data: ${data}`);
  }

  private async dispatchTextInput(chatId: string, text: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);

    // Dedicated flows keep priority: insights page, guided expense
    // step-by-step (reached via button), and the old field-edit mode.
    // Every other text input flows through the conversation agent.
    if (ctx.state === ConversationState.WAITING_QUESTION)
      return this.insights.handleQuestion(chatId, text);
    if (EXPENSE_STATES.has(ctx.state))
      return this.expense.handleText(chatId, text);

    try {
      const { text: reply, pendingConfirmation } = await this.agent.handle(
        chatId,
        text,
      );
      await this.messaging.sendText(chatId, reply);
      if (pendingConfirmation) {
        // Agent staged a saveExpense tool call → render the confirmation
        // card so the user can tap Confirm / Edit / Cancel.
        await this.expense.showConfirmation(chatId);
      }
    } catch (err) {
      this.logger.error(`Conversation agent failed for chat ${chatId}`, err);
      await this.messaging.sendText(
        chatId,
        '⚠️ Tuve un problema procesando eso. Intenta otra vez en un momento.',
      );
    }
  }
}
