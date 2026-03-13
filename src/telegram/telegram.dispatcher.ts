import { Injectable, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { ConversationService } from '../conversation/conversation.service';
import { ConversationState } from '../conversation/conversation-state.enum';
import { AiService } from '../ai/ai.service';
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
  ConversationState.WAITING_CONFIRMATION,
  ConversationState.EDITING_FIELD,
]);

@Injectable()
export class TelegramDispatcher {
  private readonly logger = new Logger(TelegramDispatcher.name);

  constructor(
    private readonly conversation: ConversationService,
    private readonly ai: AiService,
    private readonly menu: MenuHandler,
    private readonly expense: ExpenseHandler,
    private readonly receipt: ReceiptHandler,
    private readonly query: QueryHandler,
  ) {}

  async dispatchMessage(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;

    if (msg.photo) return this.receipt.handlePhoto(msg);

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
    if (/^\/(factura|receipt)/.test(text))
      return this.menu.startReceiptFlow(chatId);
    if (text.startsWith('/')) return; // ignore unknown commands

    return this.dispatchTextInput(chatId, text);
  }

  /** Called after voice transcription — routes transcribed text through normal flow */
  async dispatchVoice(chatId: number, buffer: Buffer): Promise<void> {
    const text = await this.ai.transcribeAudio(buffer);
    if (!text) {
      return this.menu.handleUnknown(chatId);
    }
    return this.dispatchTextInput(chatId, text);
  }

  async dispatchCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message!.chat.id;
    const data = query.data ?? '';

    if (data === 'cmd_gasto') return this.menu.startExpenseFlow(chatId);
    if (data === 'cmd_factura') return this.menu.startReceiptFlow(chatId);
    if (data === 'cmd_gastos') return this.query.handleRecentExpenses(chatId);
    if (data === 'cmd_mes') return this.query.handleMonthlySummary(chatId);
    if (data === 'back_menu') return this.menu.showMenu(chatId);
    if (data === 'confirm_yes') return this.expense.handleConfirmSave(chatId);
    if (data === 'confirm_no') return this.menu.handleCancel(chatId);

    if (data.startsWith('cat_'))
      return this.expense.handleCategorySelected(
        chatId,
        data.replace('cat_', ''),
      );
    if (data.startsWith('desc_'))
      return this.expense.handleDescriptionSelected(
        chatId,
        data.replace('desc_', ''),
      );
    if (data.startsWith('edit_'))
      return this.expense.handleEditField(chatId, data.replace('edit_', ''));

    this.logger.warn(`Unknown callback data: ${data}`);
  }

  private async dispatchTextInput(chatId: number, text: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);

    if (EXPENSE_STATES.has(ctx.state)) {
      return this.expense.handleText(chatId, text);
    }

    // NLP for free text in IDLE
    const intent = await this.ai.classifyIntent(text);
    if (intent === 'MANUAL_EXPENSE') return this.menu.startExpenseFlow(chatId);
    if (intent === 'QUERY_EXPENSES')
      return this.query.handleRecentExpenses(chatId);
    if (intent === 'MONTHLY_SUMMARY')
      return this.query.handleMonthlySummary(chatId);
    if (intent === 'GREETING') return this.menu.showMenu(chatId);

    return this.menu.handleUnknown(chatId);
  }
}
