import { Injectable, Inject, Logger } from '@nestjs/common';
import type { MessagingPort } from '../../shared/messaging/messaging-port.interface';
import { MESSAGING_PORT } from '../../shared/messaging/messaging-port.interface';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { SheetsService } from '../../google/sheets.service';
import { DriveService } from '../../google/drive.service';
import { I18nService } from '../../i18n/i18n.service';
import { Expense } from '../../shared/interfaces/expense.interface';
import { CATEGORIAS } from '../../shared/categorias';
import { METODOS } from '../../shared/metodos';
import { MenuHandler } from './menu.handler';
import { StepMessenger } from '../step-messenger.service';

@Injectable()
export class ExpenseHandler {
  private readonly logger = new Logger(ExpenseHandler.name);

  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
    private readonly sheets: SheetsService,
    private readonly drive: DriveService,
    private readonly i18n: I18nService,
    private readonly menuHandler: MenuHandler,
    private readonly step: StepMessenger,
  ) {}

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  }

  private formatAmount(amount: number): string {
    const [intPart, decPart] = amount.toFixed(2).split('.');
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${intFormatted},${decPart}`;
  }

  private formatDate(date: string): string {
    if (!date) return '';
    const parts = date.split('-');
    if (parts.length !== 3) return date;
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
  }

  async handleText(chatId: string, text: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    switch (ctx.state) {
      case ConversationState.WAITING_AMOUNT:
        return this.handleAmountInput(chatId, text);
      case ConversationState.WAITING_PROVIDER:
        return this.handleProviderInput(chatId, text);
      case ConversationState.WAITING_REASON:
        return this.handleReasonInput(chatId, text);
      case ConversationState.WAITING_CATEGORY:
        return;
      case ConversationState.EDITING_FIELD:
        return this.handleEditInput(chatId, text, ctx.editingField ?? '');
      default:
        return;
    }
  }

  private async handleAmountInput(chatId: string, text: string): Promise<void> {
    const monto = parseFloat(text.replace(',', '.'));
    if (isNaN(monto) || monto <= 0) {
      await this.messaging.sendText(
        chatId,
        this.i18n.get('expense.amount_invalid'),
        { parseMode: 'MarkdownV2' },
      );
      return;
    }
    this.conversation.updatePending(chatId, { amount: monto });
    this.conversation.setState(chatId, ConversationState.WAITING_PROVIDER);
    const msg = await this.messaging.sendText(
      chatId,
      this.i18n.get('expense.amount_confirmed', {
        amount: this.escape(this.formatAmount(monto)),
      }),
      { parseMode: 'MarkdownV2' },
    );
    this.conversation.addManualStepId(chatId, msg.messageId);
  }

  private async handleProviderInput(chatId: string, text: string): Promise<void> {
    this.conversation.updatePending(chatId, { provider: text });
    await this.askCategory(chatId);
  }

  async askCategory(chatId: string, deleteStep = true): Promise<void> {
    const options = CATEGORIAS.map(c => ({ id: `cat_${c.value}`, label: c.label }));
    options.push({ id: 'confirm_no', label: this.i18n.get('general.cancel') });
    const msg = await this.messaging.sendMenu(
      chatId,
      this.i18n.get('expense.ask_categoria'),
      [{ title: '', options }],
      'CATEGORIA_MENU',
    );
    this.conversation.setState(chatId, ConversationState.WAITING_CATEGORY);
    if (deleteStep) {
      this.conversation.addManualStepId(chatId, msg.messageId);
    } else {
      this.conversation.setEditStepMessageId(chatId, msg.messageId);
    }
  }

  async handleCategorySelected(chatId: string, category: string): Promise<void> {
    this.conversation.updatePending(chatId, { category });
    await this.askReason(chatId);
  }

  async askReason(chatId: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_REASON);
    const key = ctx.pendingExpense?.provider
      ? 'expense.ask_motivo'
      : 'expense.ask_motivo_generic';
    const text = this.i18n.get(key, {
      provider: this.escape(ctx.pendingExpense?.provider || ''),
    });
    const msg = await this.messaging.sendText(chatId, text, {
      parseMode: 'MarkdownV2',
    });
    this.conversation.addManualStepId(chatId, msg.messageId);
  }

  private async handleReasonInput(chatId: string, text: string): Promise<void> {
    this.conversation.updatePending(chatId, { reason: text });
    this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
    await this.showConfirmation(chatId);
  }

  async askMethod(chatId: string, deleteStep = true): Promise<void> {
    const options = METODOS.map(m => ({ id: `met_${m.value}`, label: m.label }));
    options.push({ id: 'confirm_no', label: this.i18n.get('general.cancel') });
    const msg = await this.messaging.sendMenu(
      chatId,
      this.i18n.get('expense.ask_metodo'),
      [{ title: '', options }],
      'METODO_MENU',
    );
    if (deleteStep) {
      this.conversation.addManualStepId(chatId, msg.messageId);
    } else {
      this.conversation.setEditStepMessageId(chatId, msg.messageId);
    }
  }

  async handleMethodSelected(chatId: string, method: string): Promise<void> {
    this.conversation.updatePending(chatId, { method });
    this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
    await this.showConfirmation(chatId);
  }

  async showConfirmation(chatId: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const toDelete = [...ctx.manualStepIds, ...ctx.userMessageIds];
    if (toDelete.length > 0) {
      await Promise.all(
        toDelete.map((id) => this.messaging.deleteMessage(chatId, id)),
      );
      ctx.manualStepIds = [];
      ctx.userMessageIds = [];
    }
    const e = ctx.pendingExpense;
    const divider = this.i18n.get('expense.confirmation_divider');
    const lines = [
      this.i18n.get('expense.confirmation_title'),
      divider,
      `${this.i18n.get('expense.confirmation_date')} ${this.escape(this.formatDate(e.date || ''))}`,
      `${this.i18n.get('expense.confirmation_provider')} ${this.escape(e.provider || '')}`,
      `${this.i18n.get('expense.confirmation_categoria')} ${this.escape(e.category || '—')}`,
      `${this.i18n.get('expense.confirmation_motivo')} ${this.escape(e.reason || '')}`,
      `${this.i18n.get('expense.confirmation_metodo')} ${this.escape(e.method || '—')}`,
      `${this.i18n.get('expense.confirmation_amount')} *\\$${this.escape(this.formatAmount(e.amount ?? 0))}*`,
      divider,
      this.i18n.get('expense.confirmation_question'),
    ];
    await this.step.send(chatId, lines.join('\n'), { parseMode: 'MarkdownV2' });
    const confirmMsg = await this.messaging.sendMenu(
      chatId,
      '↓',
      [
        {
          title: '',
          options: [
            { id: 'confirm_yes', label: this.i18n.get('general.confirm') },
            { id: 'confirm_no', label: this.i18n.get('general.cancel') },
            { id: 'edit_menu', label: this.i18n.get('expense.btn_edit') },
          ],
        },
      ],
      'CONFIRM_MENU',
    );
    this.conversation.setLastBotMessageId(chatId, confirmMsg.messageId);
  }

  async handleEditField(chatId: string, field: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    if (ctx.editStepMessageId) {
      await this.messaging.deleteMessage(chatId, ctx.editStepMessageId);
      this.conversation.setEditStepMessageId(chatId, undefined);
    }
    if (field === 'categoria') {
      return this.askCategory(chatId, false);
    }
    if (field === 'metodo') {
      this.conversation.setState(chatId, ConversationState.WAITING_METHOD);
      return this.askMethod(chatId, false);
    }
    this.conversation.setEditingField(chatId, field);
    this.conversation.setState(chatId, ConversationState.EDITING_FIELD);
    const msgMap: Record<string, string> = {
      amount: 'expense.edit_ask_amount',
      provider: 'expense.edit_ask_provider',
      motivo: 'expense.edit_ask_motivo',
    };
    const msgKey = msgMap[field];
    if (msgKey) {
      const msg = await this.messaging.sendText(chatId, this.i18n.get(msgKey), {
        parseMode: 'MarkdownV2',
      });
      this.conversation.setEditStepMessageId(chatId, msg.messageId);
    }
  }

  async showEditMenu(chatId: string): Promise<void> {
    const msg = await this.messaging.sendMenu(
      chatId,
      this.i18n.get('expense.edit_menu_prompt'),
      [
        {
          title: '',
          options: [
            { id: 'edit_amount', label: this.i18n.get('expense.btn_edit_amount_short') },
            { id: 'edit_provider', label: this.i18n.get('expense.btn_edit_provider_short') },
            { id: 'edit_categoria', label: this.i18n.get('expense.btn_edit_categoria_short') },
            { id: 'edit_motivo', label: this.i18n.get('expense.btn_edit_motivo_short') },
            { id: 'edit_metodo', label: this.i18n.get('expense.btn_edit_metodo_short') },
          ],
        },
      ],
      'EDIT_MENU',
    );
    this.conversation.setEditStepMessageId(chatId, msg.messageId);
  }

  private async handleEditInput(chatId: string, text: string, field: string): Promise<void> {
    switch (field) {
      case 'amount': {
        const monto = parseFloat(text.replace(',', '.'));
        if (isNaN(monto) || monto <= 0) {
          await this.messaging.sendText(
            chatId,
            this.i18n.get('expense.amount_invalid_edit'),
            { parseMode: 'MarkdownV2' },
          );
          return;
        }
        this.conversation.updatePending(chatId, { amount: monto });
        break;
      }
      case 'provider':
        this.conversation.updatePending(chatId, { provider: text });
        break;
      case 'motivo':
        this.conversation.updatePending(chatId, { reason: text });
        break;
    }
    this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
    await this.showConfirmation(chatId);
  }

  async handleConfirmSave(chatId: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    if (ctx.state !== ConversationState.WAITING_CONFIRMATION) return;
    const confirmationId = ctx.lastBotMessageId;
    this.conversation.reset(chatId);
    if (confirmationId) {
      await this.messaging.deleteMessage(chatId, confirmationId);
    }
    const e = { ...ctx.pendingExpense, by: ctx.userName } as Expense;
    const savingMsg = await this.messaging.sendText(
      chatId,
      this.i18n.get('expense.saving'),
      { parseMode: 'MarkdownV2' },
    );
    try {
      if (!e.date) e.date = new Date().toISOString().split('T')[0];
      await this.sheets.appendExpense(e);
      await this.messaging.deleteMessage(chatId, savingMsg.messageId);
      const savedText = this.i18n.get('expense.saved', {
        amount: this.escape(this.formatAmount(e.amount ?? 0)),
        provider: this.escape(e.provider || '—'),
        motivo: this.escape(e.reason || '—'),
      });
      const savedMsg = await this.messaging.sendText(chatId, savedText, {
        parseMode: 'MarkdownV2',
      });
      this.conversation.reset(chatId);
      this.conversation.setLastBotMessageId(chatId, savedMsg.messageId);
    } catch (err) {
      this.logger.error(
        `Save error: ${(err as Error).message}`,
        (err as Error).stack,
      );
      await this.messaging.sendText(
        chatId,
        this.i18n.get('expense.save_error'),
        { parseMode: 'MarkdownV2' },
      );
    }
  }
}
