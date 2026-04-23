import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ConversationService } from '../conversation/conversation.service';
import { AiService } from '../ai/ai.service';
import { MenuHandler } from '../telegram/handlers/menu.handler';
import { ExpenseHandler } from '../telegram/handlers/expense.handler';
import { ReceiptHandler } from '../telegram/handlers/receipt.handler';
import { QueryHandler } from '../telegram/handlers/query.handler';
import { InsightsHandler } from '../telegram/handlers/insights.handler';
import { TelegramDispatcher } from '../telegram/telegram.dispatcher';
import { ConversationState } from '../conversation/conversation-state.enum';
import { PhoneLinkService } from './phone-link.service';
import { ConversationAgent } from '../ai/agents/conversation.agent';
import type { MessagingPort } from '../shared/messaging/messaging-port.interface';
import { MESSAGING_PORT } from '../shared/messaging/messaging-port.interface';
import { Inject } from '@nestjs/common';

export interface TwilioWebhookPayload {
  From: string;
  Body: string;
  ButtonPayload?: string;
  ListId?: string;
  NumMedia: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
  MessageSid?: string;
}

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

// States that expect free-form text input (not a menu selection).
// When the conversation is in any of these, numeric input should be
// treated as data (e.g. amount, description) rather than as a menu index.
const TEXT_ENTRY_STATES = new Set([
  ConversationState.WAITING_AMOUNT,
  ConversationState.WAITING_PROVIDER,
  ConversationState.WAITING_DESCRIPTION,
  ConversationState.EDITING_FIELD,
]);

@Injectable()
export class WhatsAppDispatcher {
  private readonly logger = new Logger(WhatsAppDispatcher.name);
  private readonly twilioAccountSid: string;
  private readonly twilioAuthToken: string;

  constructor(
    private readonly config: ConfigService,
    private readonly conversation: ConversationService,
    private readonly ai: AiService,
    private readonly menu: MenuHandler,
    private readonly expense: ExpenseHandler,
    private readonly receipt: ReceiptHandler,
    private readonly query: QueryHandler,
    private readonly insights: InsightsHandler,
    private readonly telegramDispatcher: TelegramDispatcher,
    private readonly phoneLink: PhoneLinkService,
    private readonly agent: ConversationAgent,
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
  ) {
    this.twilioAccountSid = this.config.get<string>('TWILIO_ACCOUNT_SID') ?? '';
    this.twilioAuthToken = this.config.get<string>('TWILIO_AUTH_TOKEN') ?? '';
  }

  async dispatch(payload: TwilioWebhookPayload): Promise<void> {
    const rawPhone = payload.From.replace(/^whatsapp:/, '');
    const chatId = await this.phoneLink.resolveToCanonical(rawPhone);
    await this.conversation.load(chatId);
    try {
      return await this.dispatchInner(payload, chatId);
    } finally {
      await this.conversation.flush(chatId);
    }
  }

  private async dispatchInner(
    payload: TwilioWebhookPayload,
    chatId: string,
  ): Promise<void> {
    const messageSid = payload.MessageSid;

    if (messageSid) this.conversation.addUserMessageId(chatId, messageSid);

    // Interactive response — route as callback (quick-reply button OR list-picker item)
    const callbackPayload = payload.ButtonPayload || payload.ListId;
    if (callbackPayload) {
      this.conversation.clearPendingMenuOptions(chatId);
      return this.telegramDispatcher.routeCallbackData(chatId, callbackPayload);
    }

    // Media messages
    const numMedia = parseInt(payload.NumMedia, 10) || 0;
    if (numMedia > 0 && payload.MediaUrl0 && payload.MediaContentType0) {
      const contentType = payload.MediaContentType0;
      const buffer = await this.downloadMedia(payload.MediaUrl0);
      if (contentType.startsWith('image/')) {
        return this.receipt.handlePhotoBuffer(chatId, buffer);
      }
      if (contentType.startsWith('audio/')) {
        return this.telegramDispatcher.dispatchVoice(
          chatId,
          buffer,
          messageSid,
        );
      }
    }

    const text = payload.Body?.trim() ?? '';
    const ctx = this.conversation.getContext(chatId);

    // Numeric menu selection — WhatsApp has no inline keyboards, so we map
    // the user's number to the previously-sent menu's option id. Skip this
    // when the user is in a text-entry state (e.g. typing an amount), where
    // a bare digit is real data, not a menu index.
    const numericMatch = /^(\d+)$/.exec(text);
    if (numericMatch && !TEXT_ENTRY_STATES.has(ctx.state)) {
      const pendingOptions = this.conversation.getPendingMenuOptions(chatId);
      if (pendingOptions && pendingOptions.length > 0) {
        const idx = parseInt(numericMatch[1], 10) - 1;
        if (idx >= 0 && idx < pendingOptions.length) {
          this.conversation.clearPendingMenuOptions(chatId);
          return this.telegramDispatcher.routeCallbackData(
            chatId,
            pendingOptions[idx],
          );
        }
      }
    }

    // Commands
    if (/^\/start/.test(text)) return this.menu.showMenu(chatId);
    if (/^\/(cancel|cancelar)/.test(text))
      return this.menu.handleCancel(chatId);
    if (/^\/(gastos|expenses)/.test(text))
      return this.query.handleRecentExpenses(chatId);
    if (/^\/(mes|month)/.test(text))
      return this.query.handleMonthlySummary(chatId);
    if (/^\/(gasto|expense)/.test(text))
      return this.menu.startExpenseFlow(chatId);
    if (text.startsWith('/')) return;

    // Text input
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
        await this.expense.showConfirmation(chatId);
      }
    } catch (err) {
      this.logger.error(
        `Conversation agent failed for WhatsApp ${chatId}`,
        err,
      );
      await this.messaging.sendText(
        chatId,
        '⚠️ Tuve un problema procesando eso. Intenta otra vez en un momento.',
      );
    }
  }

  private async downloadMedia(url: string): Promise<Buffer> {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      auth: { username: this.twilioAccountSid, password: this.twilioAuthToken },
    });
    return Buffer.from(res.data);
  }
}
