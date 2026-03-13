import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { ConversationService } from '../conversation/conversation.service';
import { ConversationState } from '../conversation/conversation-state.enum';
import { OpenAiService } from '../openai/openai.service';
import { SheetsService } from '../sheets/sheets.service';
import { DriveService } from '../drive/drive.service';
import { I18nService } from '../i18n/i18n.service';
import { Expense } from '../shared/interfaces/expense.interface';

const CATEGORIES: { label: string; value: string }[] = [
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
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot;

  constructor(
    private config: ConfigService,
    private conversation: ConversationService,
    private openai: OpenAiService,
    private sheets: SheetsService,
    private drive: DriveService,
    private i18n: I18nService,
  ) {}

  async onModuleInit() {
    this.bot = new TelegramBot(
      this.config.get<string>('TELEGRAM_BOT_TOKEN')!,
      { polling: true },
    );
    this.registerHandlers();
    this.logger.log('Bot started (polling)');
  }

  // ─── Register all handlers ───────────────────────────────────────────

  private registerHandlers() {
    this.bot.onText(/\/start/, (msg) => this.handleStart(msg.chat.id));
    this.bot.onText(/\/gasto|\/expense/, (msg) => this.handleGastoCommand(msg.chat.id));
    this.bot.onText(/\/factura|\/receipt/, (msg) => this.handleFacturaCommand(msg.chat.id));
    this.bot.onText(/\/gastos|\/expenses/, (msg) => this.handleGetExpenses(msg.chat.id));
    this.bot.onText(/\/mes|\/month/, (msg) => this.handleMonthlySummary(msg.chat.id));
    this.bot.onText(/\/cancel|\/cancelar/, (msg) => this.handleCancel(msg.chat.id));

    this.bot.on('message', (msg) => {
      if (msg.photo) return this.handlePhoto(msg);
      if (msg.text && !msg.text.startsWith('/')) return this.handleMessage(msg);
    });

    this.bot.on('callback_query', (query) => this.handleCallbackQuery(query));
  }

  // ─── Menu ─────────────────────────────────────────────────────────────

  private async handleStart(chatId: number) {
    this.conversation.reset(chatId);
    await this.bot.sendMessage(chatId, this.i18n.get('menu.welcome'), {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [
            { text: this.i18n.get('menu.btn_log_expense'), callback_data: 'cmd_gasto' },
            { text: this.i18n.get('menu.btn_upload_receipt'), callback_data: 'cmd_factura' },
          ],
          [
            { text: this.i18n.get('menu.btn_recent'), callback_data: 'cmd_gastos' },
            { text: this.i18n.get('menu.btn_summary'), callback_data: 'cmd_mes' },
          ],
        ],
      },
    });
  }

  // ─── Expense flow ─────────────────────────────────────────────────────

  private async handleGastoCommand(chatId: number) {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_AMOUNT);
    await this.bot.sendMessage(chatId, this.i18n.get('expense.ask_amount'), {
      parse_mode: 'MarkdownV2',
    });
  }

  private async handleAmountInput(chatId: number, text: string) {
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

  private async handleProviderInput(chatId: number, text: string) {
    this.conversation.updatePending(chatId, { proveedor: text });
    this.conversation.setState(chatId, ConversationState.WAITING_CATEGORY);
    await this.askCategory(chatId);
  }

  private async askCategory(chatId: number) {
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
    const text = this.i18n.get(key, {
      provider: this.escape(ctx.pendingExpense?.proveedor || ''),
    });

    await this.bot.sendMessage(chatId, text, {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  private async askDescription(chatId: number) {
    this.conversation.setState(chatId, ConversationState.WAITING_DESCRIPTION);
    await this.bot.sendMessage(
      chatId,
      this.i18n.get('expense.ask_description'),
      {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Climbing gear purchase', callback_data: 'desc_Climbing gear purchase' },
              { text: 'Wall maintenance', callback_data: 'desc_Wall maintenance' },
            ],
            [
              { text: 'Monthly service', callback_data: 'desc_Monthly service' },
              { text: 'Cleaning supplies', callback_data: 'desc_Cleaning supplies' },
            ],
            [
              { text: this.i18n.get('expense.desc_opt_custom'), callback_data: 'desc_custom' },
            ],
          ],
        },
      },
    );
  }

  private async handleDescriptionInput(chatId: number, text: string) {
    this.conversation.updatePending(chatId, { descripcion: text });
    this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
    await this.askConfirmation(chatId);
  }

  private async askConfirmation(chatId: number) {
    const ctx = this.conversation.getContext(chatId);
    const e = ctx.pendingExpense;

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
            { text: this.i18n.get('general.confirm'), callback_data: 'confirm_yes' },
            { text: this.i18n.get('general.cancel'), callback_data: 'confirm_no' },
          ],
          [
            { text: this.i18n.get('expense.btn_edit_amount'), callback_data: 'edit_amount' },
            { text: this.i18n.get('expense.btn_edit_provider'), callback_data: 'edit_provider' },
          ],
          [
            { text: this.i18n.get('expense.btn_edit_category'), callback_data: 'edit_category' },
            { text: this.i18n.get('expense.btn_edit_description'), callback_data: 'edit_description' },
          ],
        ],
      },
    });
  }

  // ─── Receipt flow ─────────────────────────────────────────────────────

  private async handleFacturaCommand(chatId: number) {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_RECEIPT);
    await this.bot.sendMessage(chatId, this.i18n.get('receipt.ask'), {
      parse_mode: 'MarkdownV2',
    });
  }

  private async handlePhoto(msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    this.conversation.setState(chatId, ConversationState.WAITING_RECEIPT);
    const processing = await this.bot.sendMessage(
      chatId,
      this.i18n.get('receipt.processing'),
      { parse_mode: 'MarkdownV2' },
    );

    try {
      const photo = msg.photo![msg.photo!.length - 1];
      const fileLink = await this.bot.getFileLink(photo.file_id);
      const res = await axios.get(fileLink, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(res.data);

      this.conversation.setImageBuffer(chatId, buffer);
      const extracted = await this.openai.extractFromImage(buffer);
      if (!extracted.fecha) {
        extracted.fecha = new Date().toISOString().split('T')[0];
      }

      this.conversation.updatePending(chatId, extracted);
      this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);

      try {
        await this.bot.deleteMessage(chatId, processing.message_id);
      } catch {
        // ignore delete errors
      }

      await this.askConfirmation(chatId);
    } catch (err) {
      this.logger.error('Photo handling error', err);
      await this.bot.sendMessage(chatId, this.i18n.get('receipt.error'), {
        parse_mode: 'MarkdownV2',
      });
    }
  }

  // ─── Callback query handler ───────────────────────────────────────────

  private async handleCallbackQuery(query: TelegramBot.CallbackQuery) {
    const chatId = query.message!.chat.id;
    const data = query.data ?? '';

    await this.bot.answerCallbackQuery(query.id);

    if (data === 'cmd_gasto') return this.handleGastoCommand(chatId);
    if (data === 'cmd_factura') return this.handleFacturaCommand(chatId);
    if (data === 'cmd_gastos') return this.handleGetExpenses(chatId);
    if (data === 'cmd_mes') return this.handleMonthlySummary(chatId);
    if (data === 'back_menu') return this.handleStart(chatId);

    if (data === 'confirm_yes') return this.handleConfirmSave(chatId);
    if (data === 'confirm_no') return this.handleCancel(chatId);

    if (data.startsWith('cat_')) {
      const category = data.replace('cat_', '');
      this.conversation.updatePending(chatId, { categoria: category });
      return this.askDescription(chatId);
    }

    if (data.startsWith('desc_')) {
      const desc = data.replace('desc_', '');
      if (desc === 'custom') {
        await this.bot.sendMessage(
          chatId,
          this.i18n.get('expense.ask_description_write'),
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }
      return this.handleDescriptionInput(chatId, desc);
    }

    if (data === 'edit_amount') {
      this.conversation.setEditingField(chatId, 'amount');
      this.conversation.setState(chatId, ConversationState.EDITING_FIELD);
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('expense.edit_ask_amount'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    if (data === 'edit_provider') {
      this.conversation.setEditingField(chatId, 'provider');
      this.conversation.setState(chatId, ConversationState.EDITING_FIELD);
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('expense.edit_ask_provider'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    if (data === 'edit_category') {
      this.conversation.setState(chatId, ConversationState.WAITING_CATEGORY);
      return this.askCategory(chatId);
    }

    if (data === 'edit_description') {
      this.conversation.setEditingField(chatId, 'description');
      this.conversation.setState(chatId, ConversationState.EDITING_FIELD);
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('expense.edit_ask_description'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }
  }

  // ─── Save expense ─────────────────────────────────────────────────────

  private async handleConfirmSave(chatId: number) {
    const ctx = this.conversation.getContext(chatId);
    const e = { ...ctx.pendingExpense } as Expense;

    await this.bot.sendMessage(chatId, this.i18n.get('expense.saving'), {
      parse_mode: 'MarkdownV2',
    });

    try {
      let receiptLink = '';
      if (ctx.lastImageBuffer) {
        const filename = `receipt_${Date.now()}.jpg`;
        receiptLink = await this.drive.uploadImage(ctx.lastImageBuffer, filename);
        e.facturaLink = receiptLink;
      }
      if (!e.fecha) e.fecha = new Date().toISOString().split('T')[0];

      await this.sheets.appendExpense(e);

      const msgKey = receiptLink ? 'expense.saved_with_receipt' : 'expense.saved';
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
      setTimeout(() => this.handleStart(chatId), 1500);
    } catch (err) {
      this.logger.error('Save error', err);
      await this.bot.sendMessage(chatId, this.i18n.get('expense.save_error'), {
        parse_mode: 'MarkdownV2',
      });
    }
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  private async handleGetExpenses(chatId: number) {
    try {
      const expenses = await this.sheets.getLastExpenses(5);
      if (!expenses.length) {
        await this.bot.sendMessage(
          chatId,
          this.i18n.get('queries.no_expenses'),
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }
      const lines = [this.i18n.get('queries.recent_title'), ''];
      for (const exp of expenses) {
        lines.push(
          this.i18n.get('queries.recent_row', {
            date: this.escape(exp.fecha),
            provider: this.escape(exp.proveedor),
            amount: exp.monto.toFixed(2),
            category: this.escape(exp.categoria),
          }),
        );
      }
      await this.bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'MarkdownV2',
      });
    } catch (err) {
      this.logger.error('Get expenses error', err);
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('queries.recent_error'),
        { parse_mode: 'MarkdownV2' },
      );
    }
  }

  private async handleMonthlySummary(chatId: number) {
    try {
      const yearMonth = new Date().toISOString().slice(0, 7);
      const summary = await this.sheets.getMonthlySummary(yearMonth);
      const monthName = new Date(yearMonth + '-01').toLocaleDateString(
        'en-US',
        { month: 'long', year: 'numeric' },
      );

      const lines = [
        this.i18n.get('queries.summary_title', {
          month: this.escape(monthName),
        }),
        '',
        this.i18n.get('queries.summary_total', {
          total: summary.total.toFixed(2),
        }),
        this.i18n.get('queries.summary_count', {
          count: summary.cantidadGastos,
        }),
        '',
        this.i18n.get('queries.summary_by_category'),
      ];

      for (const [cat, amount] of Object.entries(summary.porCategoria)) {
        lines.push(
          this.i18n.get('queries.summary_row', {
            category: this.escape(cat),
            amount: (amount as number).toFixed(2),
          }),
        );
      }

      await this.bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'MarkdownV2',
      });
    } catch (err) {
      this.logger.error('Monthly summary error', err);
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('queries.summary_error'),
        { parse_mode: 'MarkdownV2' },
      );
    }
  }

  // ─── Cancel ───────────────────────────────────────────────────────────

  private async handleCancel(chatId: number) {
    this.conversation.reset(chatId);
    await this.bot.sendMessage(chatId, this.i18n.get('general.cancelled'), {
      parse_mode: 'MarkdownV2',
    });
    setTimeout(() => this.handleStart(chatId), 1000);
  }

  // ─── Free text / NLP ──────────────────────────────────────────────────

  private async handleMessage(msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    const text = msg.text?.trim() || '';
    const ctx = this.conversation.getContext(chatId);

    if (ctx.state === ConversationState.WAITING_AMOUNT)
      return this.handleAmountInput(chatId, text);
    if (ctx.state === ConversationState.WAITING_PROVIDER)
      return this.handleProviderInput(chatId, text);
    if (ctx.state === ConversationState.WAITING_DESCRIPTION)
      return this.handleDescriptionInput(chatId, text);
    if (ctx.state === ConversationState.EDITING_FIELD)
      return this.handleEditInput(chatId, text, ctx.editingField ?? '');

    const intent = await this.openai.classifyIntent(text);
    if (intent === 'MANUAL_EXPENSE') return this.handleGastoCommand(chatId);
    if (intent === 'QUERY_EXPENSES') return this.handleGetExpenses(chatId);
    if (intent === 'MONTHLY_SUMMARY') return this.handleMonthlySummary(chatId);
    if (intent === 'GREETING') return this.handleStart(chatId);

    await this.bot.sendMessage(chatId, this.i18n.get('nlp.unknown'), {
      parse_mode: 'MarkdownV2',
    });
  }

  private async handleEditInput(
    chatId: number,
    text: string,
    field: string,
  ) {
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
    await this.askConfirmation(chatId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  }
}
