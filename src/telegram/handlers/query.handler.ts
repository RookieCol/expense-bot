import { Injectable, Inject, Logger } from '@nestjs/common';
import type { MessagingPort } from '../../shared/messaging/messaging-port.interface';
import { MESSAGING_PORT } from '../../shared/messaging/messaging-port.interface';
import { SheetsService } from '../../google/sheets.service';
import { I18nService } from '../../i18n/i18n.service';
import { CATEGORY_LABEL } from '../../shared/categories';
import { StepMessenger } from '../step-messenger.service';

@Injectable()
export class QueryHandler {
  private readonly logger = new Logger(QueryHandler.name);

  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly sheets: SheetsService,
    private readonly i18n: I18nService,
    private readonly step: StepMessenger,
  ) {}

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  }

  private formatAmount(amount: number): string {
    return Math.round(amount)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  private formatDate(fecha: string): string {
    const [y, m, d] = fecha.split('-');
    return `${d}/${m}/${y.slice(2)}`;
  }

  async handleRecentExpenses(chatId: string): Promise<void> {
    try {
      const expenses = await this.sheets.getLastExpenses(5);
      if (!expenses.length) {
        await this.messaging.sendText(
          chatId,
          this.i18n.get('queries.no_expenses'),
          { parseMode: 'MarkdownV2' },
        );
        return;
      }
      const cards = expenses.map((exp) => {
        const date     = this.formatDate(exp.fecha);
        const amount   = `$${this.formatAmount(exp.monto)}`;
        const provider = exp.proveedor || '—';
        const category = CATEGORY_LABEL[exp.categoria ?? ''] ?? exp.categoria ?? '—';
        const line1 = `📅 ${this.escape(date)}  💰 *${this.escape(amount)}*`;
        const line2 = `🏪 ${this.escape(provider)} · ${this.escape(category)}`;
        return `${line1}\n${line2}`;
      });
      const title = this.i18n.get('queries.recent_title');
      await this.step.send(chatId, `${title}\n\n${cards.join('\n\n')}`, { parseMode: 'MarkdownV2' });
    } catch (err) {
      this.logger.error(`Get expenses error: ${(err as Error).message}`, (err as Error).stack);
      await this.messaging.sendText(chatId, this.i18n.get('queries.recent_error'), { parseMode: 'MarkdownV2' });
    }
  }

  async handleMonthlySummary(chatId: string): Promise<void> {
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const summary = await this.sheets.getMonthlySummary(yearMonth);
      const monthName = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString(
        'es-CO',
        { month: 'long', year: 'numeric' },
      );
      const title = this.i18n.get('queries.summary_title', { month: this.escape(monthName) });
      const totLine =
        `💰 *\\$${this.escape(this.formatAmount(summary.total))}*` +
        `  ·  🧾 ${String(summary.cantidadGastos)} gastos`;
      const C_CAT = 20;
      const C_AMT = 10;
      const divider = '─'.repeat(C_CAT + C_AMT + 1);
      const header  = 'Categoría'.padEnd(C_CAT + 1) + 'Valor'.padStart(C_AMT);
      const entries = Object.entries(summary.porCategoria) as [string, number][];
      entries.sort((a, b) => b[1] - a[1]);
      const rows = entries.map(([cat, amt]) => {
        const category = (CATEGORY_LABEL[cat] ?? cat).substring(0, C_CAT).padEnd(C_CAT + 1);
        const amount   = `$${this.formatAmount(amt)}`.padStart(C_AMT);
        return category + amount;
      });
      const table = '```\n' + [header, divider, ...rows].join('\n') + '\n```';
      await this.step.send(chatId, [title, '', totLine, '', table].join('\n'), { parseMode: 'MarkdownV2' });
    } catch (err) {
      this.logger.error(`Monthly summary error: ${(err as Error).message}`, (err as Error).stack);
      await this.messaging.sendText(chatId, this.i18n.get('queries.summary_error'), { parseMode: 'MarkdownV2' });
    }
  }
}
