import { Injectable, Inject, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { BOT } from '../bot.provider';
import { SheetsService } from '../../google/sheets.service';
import { I18nService } from '../../i18n/i18n.service';

@Injectable()
export class QueryHandler {
  private readonly logger = new Logger(QueryHandler.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly sheets: SheetsService,
    private readonly i18n: I18nService,
  ) {}

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  }

  private formatAmount(amount: number): string {
    const [intPart, decPart] = amount.toFixed(2).split('.');
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${intFormatted},${decPart}`;
  }

  async handleRecentExpenses(chatId: number): Promise<void> {
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
            amount: this.escape(this.formatAmount(exp.monto)),
            category: this.escape(exp.categoria),
          }),
        );
      }
      await this.bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'MarkdownV2',
      });
    } catch (err) {
      this.logger.error(`Get expenses error: ${(err as Error).message}`, (err as Error).stack);
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('queries.recent_error'),
        { parse_mode: 'MarkdownV2' },
      );
    }
  }

  async handleMonthlySummary(chatId: number): Promise<void> {
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const summary = await this.sheets.getMonthlySummary(yearMonth);
      const monthName = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString(
        'en-US',
        { month: 'long', year: 'numeric' },
      );
      const lines = [
        this.i18n.get('queries.summary_title', {
          month: this.escape(monthName),
        }),
        '',
        this.i18n.get('queries.summary_total', {
          total: this.escape(this.formatAmount(summary.total)),
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
            amount: this.escape(this.formatAmount(amount)),
          }),
        );
      }
      await this.bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'MarkdownV2',
      });
    } catch (err) {
      this.logger.error(`Monthly summary error: ${(err as Error).message}`, (err as Error).stack);
      await this.bot.sendMessage(
        chatId,
        this.i18n.get('queries.summary_error'),
        { parse_mode: 'MarkdownV2' },
      );
    }
  }
}
