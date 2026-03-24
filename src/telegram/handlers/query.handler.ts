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

  /** Pesos without cents, thousands separator = period: 1.234 */
  private formatAmount(amount: number): string {
    return Math.round(amount)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /** YYYY-MM-DD → DD/MM/YY */
  private formatDate(fecha: string): string {
    const [y, m, d] = fecha.split('-');
    return `${d}/${m}/${y.slice(2)}`;
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

      // Build monospace table inside a code block (no escaping needed inside ```)
      const C_DATE = 8;
      const C_PROV = 14;
      const C_CAT  = 14;
      const C_AMT  = 9;
      const divider = '─'.repeat(C_DATE + C_PROV + C_CAT + C_AMT + 3);

      const header =
        'Fecha'.padEnd(C_DATE + 1) +
        'Proveedor'.padEnd(C_PROV + 1) +
        'Categoría'.padEnd(C_CAT + 1) +
        'Valor'.padStart(C_AMT);

      const rows = expenses.map((exp) => {
        const date     = this.formatDate(exp.fecha).padEnd(C_DATE + 1);
        const provider = (exp.proveedor || '—').substring(0, C_PROV).padEnd(C_PROV + 1);
        const category = (exp.categoria || '—').substring(0, C_CAT).padEnd(C_CAT + 1);
        const amount   = `$${this.formatAmount(exp.monto)}`.padStart(C_AMT);
        return date + provider + category + amount;
      });

      const table = '```\n' + [header, divider, ...rows].join('\n') + '\n```';
      const title = this.i18n.get('queries.recent_title');

      await this.bot.sendMessage(chatId, `${title}\n\n${table}`, {
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
        'es-CO',
        { month: 'long', year: 'numeric' },
      );

      // Header line
      const title = this.i18n.get('queries.summary_title', {
        month: this.escape(monthName),
      });
      const totLine =
        `💰 *\\$${this.escape(this.formatAmount(summary.total))}*` +
        `  ·  🧾 ${String(summary.cantidadGastos)} gastos`;

      // Category table
      const C_CAT = 20;
      const C_AMT = 10;
      const divider = '─'.repeat(C_CAT + C_AMT + 1);
      const header  = 'Categoría'.padEnd(C_CAT + 1) + 'Valor'.padStart(C_AMT);

      const entries = Object.entries(summary.porCategoria) as [string, number][];
      entries.sort((a, b) => b[1] - a[1]);

      const rows = entries.map(([cat, amt]) => {
        const category = cat.substring(0, C_CAT).padEnd(C_CAT + 1);
        const amount   = `$${this.formatAmount(amt)}`.padStart(C_AMT);
        return category + amount;
      });

      const table = '```\n' + [header, divider, ...rows].join('\n') + '\n```';

      await this.bot.sendMessage(
        chatId,
        [title, '', totLine, '', table].join('\n'),
        { parse_mode: 'MarkdownV2' },
      );
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
