import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ConversationService } from '../conversation/conversation.service';
import { AiService } from '../ai/ai.service';
import { MenuHandler } from '../telegram/handlers/menu.handler';
import { ExpenseHandler } from '../telegram/handlers/expense.handler';
import { ReceiptHandler } from '../telegram/handlers/receipt.handler';
import { QueryHandler } from '../telegram/handlers/query.handler';
import { TelegramDispatcher } from '../telegram/telegram.dispatcher';
import { ConversationState } from '../conversation/conversation-state.enum';
import { PhoneLinkService } from './phone-link.service';

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
    private readonly telegramDispatcher: TelegramDispatcher,
    private readonly phoneLink: PhoneLinkService,
  ) {
    this.twilioAccountSid = this.config.get<string>('TWILIO_ACCOUNT_SID') ?? '';
    this.twilioAuthToken  = this.config.get<string>('TWILIO_AUTH_TOKEN') ?? '';
  }

  async dispatch(payload: TwilioWebhookPayload): Promise<void> {
    const rawPhone = payload.From.replace(/^whatsapp:/, '');
    const chatId = this.phoneLink.resolveToCanonical(rawPhone);
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
        return this.telegramDispatcher.dispatchVoice(chatId, buffer, messageSid);
      }
    }

    const text = payload.Body?.trim() ?? '';

    // Numeric menu selection — WhatsApp has no inline keyboards, so we map
    // the user's number to the previously-sent menu's option id.
    const numericMatch = /^(\d+)$/.exec(text);
    if (numericMatch) {
      const pendingOptions = this.conversation.getPendingMenuOptions(chatId);
      if (pendingOptions && pendingOptions.length > 0) {
        const idx = parseInt(numericMatch[1], 10) - 1;
        if (idx >= 0 && idx < pendingOptions.length) {
          this.conversation.clearPendingMenuOptions(chatId);
          return this.telegramDispatcher.routeCallbackData(chatId, pendingOptions[idx]);
        }
      }
    }

    // Commands
    if (/^\/start/.test(text)) return this.menu.showMenu(chatId);
    if (/^\/(cancel|cancelar)/.test(text)) return this.menu.handleCancel(chatId);
    if (/^\/(gastos|expenses)/.test(text)) return this.query.handleRecentExpenses(chatId);
    if (/^\/(mes|month)/.test(text)) return this.query.handleMonthlySummary(chatId);
    if (/^\/(gasto|expense)/.test(text)) return this.menu.startExpenseFlow(chatId);
    if (text.startsWith('/')) return;

    // Text input
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
      this.logger.error(`AI dispatch failed for WhatsApp ${chatId}`, err);
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
