import { Injectable, Inject, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { BOT } from '../bot.provider';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { SheetsService } from '../../google/sheets.service';
import { DriveService } from '../../google/drive.service';
import { I18nService } from '../../i18n/i18n.service';
import { Expense } from '../../shared/interfaces/expense.interface';
import { MenuHandler } from './menu.handler';

const CATEGORIES = [
  { label: '🧗 Equipment',          value: 'Equipment' },
  { label: '🔧 Maintenance',        value: 'Maintenance' },
  { label: '💡 Utilities',          value: 'Utilities' },
  { label: '🧹 Cleaning',           value: 'Cleaning' },
  { label: '📣 Marketing',          value: 'Marketing' },
  { label: '👕 Uniforms',           value: 'Uniforms' },
  { label: '🏥 Insurance & Health', value: 'Insurance & Health' },
  { label: '💼 Administration',     value: 'Administration' },
  { label: '🎉 Events',             value: 'Events' },
  { label: '🔀 Other',              value: 'Other' },
];

@Injectable()
export class ExpenseHandler {
  private readonly logger = new Logger(ExpenseHandler.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly conversation: ConversationService,
    private readonly sheets: SheetsService,
    private readonly drive: DriveService,
    private readonly i18n: I18nService,
    private readonly menuHandler: MenuHandler,
  ) {}

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  }

  /** Entry point for all text messages while in an expense flow state */
  async handleText(chatId: number, text: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    switch (ctx.state) {
      case ConversationState.WAITING_AMOUNT:
        return this.handleAmountInput(chatId, text);
      case ConversationState.WAITING_PROVIDER:
        return this.handleProviderInput(chatId, text);
      case ConversationState.WAITING_DESCRIPTION:
        return this.handleDescriptionInput(chatId, text);
      case ConversationState.EDITING_FIELD:
        return this.handleEditInput(chatId, text, ctx.editingField ?? '');
      // WAITING_CATEGORY and WAITING_RECEIPT require button/photo — silently ignore text
      default:
        return;
    }
  }

  private async handleAmountInput(chatId: number, text: string): Promise<void> {
    const monto = parseFloat(text.replace(',', '.'));
    if (isNaN(monto) || monto <= 0) {
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('expense.amount_invalid'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }
    this.conversation.updatePending(chatId, { monto });
    this.conversation.setState(chatId, ConversationState.WAITING_PROVIDER);
    await this.bot.sendMessage(
      chatId,
      this.i18n.get('expense.amount_confirmed', { amount: monto.toFixed(2) }),
      { parse_mode: 'MarkdownV2' },
    );
  }

  private async handleProviderInput(
    chatId: number,
    text: string,
  ): Promise<void> {
    this.conversation.updatePending(chatId, { proveedor: text });
    this.conversation.setState(chatId, ConversationState.WAITING_CATEGORY);
    await this.askCategory(chatId);
  }

  async askCategory(chatId: number): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    for (let i = 0; i < CATEGORIES.length; i += 2) {
      keyboard.push(
        CATEGORIES.slice(i, i + 2).map((c) => ({
          text: c.label,
          callback_data: `cat_${c.value}`,
        })),
      );
    }
    keyboard.push([
      { text: this.i18n.get('general.cancel'), callback_data: 'confirm_no' },
    ]);
    const key = ctx.pendingExpense?.proveedor
      ? 'expense.ask_category'
      : 'expense.ask_category_generic';
    await this.bot.sendMessage(
      chatId,
      this.i18n.get(key, {
        provider: this.escape(ctx.pendingExpense?.proveedor || ''),
      }),
      { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } },
    );
  }

  async handleCategorySelected(
    chatId: number,
    category: string,
  ): Promise<void> {
    this.conversation.updatePending(chatId, { categoria: category });
    await this.askDescription(chatId);
  }

  private async askDescription(chatId: number): Promise<void> {
    this.conversation.setState(chatId, ConversationState.WAITING_DESCRIPTION);
    await this.bot.sendMessage(
      chatId,
      this.i18n.get('expense.ask_description'),
      {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Climbing gear purchase',
                callback_data: 'desc_Climbing gear purchase',
              },
              {
                text: 'Wall maintenance',
                callback_data: 'desc_Wall maintenance',
              },
            ],
            [
              {
                text: 'Monthly service',
                callback_data: 'desc_Monthly service',
              },
              {
                text: 'Cleaning supplies',
                callback_data: 'desc_Cleaning supplies',
              },
            ],
            [
              {
                text: this.i18n.get('expense.desc_opt_custom'),
                callback_data: 'desc_custom',
              },
            ],
          ],
        },
      },
    );
  }

  async handleDescriptionSelected(
    chatId: number,
    desc: string,
  ): Promise<void> {
    if (desc === 'custom') {
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('expense.ask_description_write'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }
    await this.handleDescriptionInput(chatId, desc);
  }

  private async handleDescriptionInput(
    chatId: number,
    text: string,
  ): Promise<void> {
    this.conversation.updatePending(chatId, { descripcion: text });
    this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
    await this.showConfirmation(chatId);
  }

  /** Called by ReceiptHandler after pre-filling pendingExpense */
  async showConfirmation(chatId: number): Promise<void> {
    const e = this.conversation.getContext(chatId).pendingExpense;
    const lines = [
      this.i18n.get('expense.confirmation_title'),
      '',
      `${this.i18n.get('expense.confirmation_date')} ${this.escape(e.fecha || '')}`,
      `${this.i18n.get('expense.confirmation_provider')} ${this.escape(e.proveedor || '')}`,
      `${this.i18n.get('expense.confirmation_category')} ${this.escape(e.categoria || '')}`,
      `${this.i18n.get('expense.confirmation_description')} ${this.escape(e.descripcion || '')}`,
      `${this.i18n.get('expense.confirmation_amount')} \\$${this.escape((e.monto ?? 0).toFixed(2))}`,
      '',
      this.i18n.get('expense.confirmation_question'),
    ];
    await this.bot.sendMessage(chatId, lines.join('\n'), {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: this.i18n.get('general.confirm'),
              callback_data: 'confirm_yes',
            },
            {
              text: this.i18n.get('general.cancel'),
              callback_data: 'confirm_no',
            },
          ],
          [
            {
              text: this.i18n.get('expense.btn_edit_amount'),
              callback_data: 'edit_amount',
            },
            {
              text: this.i18n.get('expense.btn_edit_provider'),
              callback_data: 'edit_provider',
            },
          ],
          [
            {
              text: this.i18n.get('expense.btn_edit_category'),
              callback_data: 'edit_category',
            },
            {
              text: this.i18n.get('expense.btn_edit_description'),
              callback_data: 'edit_description',
            },
          ],
        ],
      },
    });
  }

  async handleEditField(chatId: number, field: string): Promise<void> {
    if (field === 'category') {
      this.conversation.setState(chatId, ConversationState.WAITING_CATEGORY);
      return this.askCategory(chatId);
    }
    this.conversation.setEditingField(chatId, field);
    this.conversation.setState(chatId, ConversationState.EDITING_FIELD);
    const msgMap: Record<string, string> = {
      amount:      'expense.edit_ask_amount',
      provider:    'expense.edit_ask_provider',
      description: 'expense.edit_ask_description',
    };
    const msgKey = msgMap[field];
    if (msgKey) {
      await this.bot.sendMessage(chatId, this.i18n.get(msgKey), {
        parse_mode: 'MarkdownV2',
      });
    }
  }

  private async handleEditInput(
    chatId: number,
    text: string,
    field: string,
  ): Promise<void> {
    switch (field) {
      case 'amount': {
        const monto = parseFloat(text.replace(',', '.'));
        if (isNaN(monto) || monto <= 0) {
          await this.bot.sendMessage(
            chatId,
            this.i18n.get('expense.amount_invalid_edit'),
            { parse_mode: 'MarkdownV2' },
          );
          return;
        }
        this.conversation.updatePending(chatId, { monto });
        break;
      }
      case 'provider':
        this.conversation.updatePending(chatId, { proveedor: text });
        break;
      case 'description':
        this.conversation.updatePending(chatId, { descripcion: text });
        break;
    }
    this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
    await this.showConfirmation(chatId);
  }

  async handleConfirmSave(chatId: number): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const e = { ...ctx.pendingExpense } as Expense;

    await this.bot.sendMessage(chatId, this.i18n.get('expense.saving'), {
      parse_mode: 'MarkdownV2',
    });

    try {
      let receiptLink = '';
      if (ctx.lastImageBuffer) {
        const filename = `receipt_${Date.now()}.jpg`;
        receiptLink = await this.drive.uploadImage(
          ctx.lastImageBuffer,
          filename,
        );
        e.facturaLink = receiptLink;
      }
      if (!e.fecha) e.fecha = new Date().toISOString().split('T')[0];

      await this.sheets.appendExpense(e);

      const msgKey = receiptLink
        ? 'expense.saved_with_receipt'
        : 'expense.saved';
      await this.bot.sendMessage(
        chatId,
        this.i18n.get(msgKey, {
          amount: (e.monto ?? 0).toFixed(2),
          provider: this.escape(e.proveedor || ''),
          link: receiptLink,
        }),
        { parse_mode: 'MarkdownV2' },
      );

      this.conversation.reset(chatId);
      setTimeout(() => this.menuHandler.showMenu(chatId), 1500);
    } catch (err) {
      this.logger.error('Save error', err);
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('expense.save_error'),
        { parse_mode: 'MarkdownV2' },
      );
    }
  }
}
