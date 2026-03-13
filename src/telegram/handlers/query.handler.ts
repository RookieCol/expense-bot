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

  async handleMonthlySummary(chatId: number): Promise<void> {
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
}
