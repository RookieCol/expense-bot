import { Injectable, Inject, Logger } from '@nestjs/common';
import type { MessagingPort } from '../../shared/messaging/messaging-port.interface';
import { MESSAGING_PORT } from '../../shared/messaging/messaging-port.interface';
import { SheetsService } from '../../google/sheets.service';
import { I18nService } from '../../i18n/i18n.service';
import { StepMessenger } from '../step-messenger.service';

const DIVIDER = '━━━━━━━━━━━━━━━━';

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

  private formatDate(date: string): string {
    const [y, m, d] = date.split('-');
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
        const date = this.formatDate(exp.date);
        const amount = `\\$${this.escape(this.formatAmount(exp.amount))}`;
        const provider = exp.provider || '—';
        const category = exp.category || '—';
        const reason = exp.reason || '—';
        return [
          `📅 ${this.escape(date)}  ·  💰 *${amount}*`,
          `🏪 ${this.escape(provider)}  ·  🗂️ ${this.escape(category)}`,
          `📝 ${this.escape(reason)}`,
        ].join('\n');
      });
      const title = this.i18n.get('queries.recent_title');
      const body = cards.join(`\n${DIVIDER}\n`);
      await this.step.send(chatId, `${title}\n${DIVIDER}\n${body}`, {
        parseMode: 'MarkdownV2',
      });
    } catch (err) {
      this.logger.error(
        `Get expenses error: ${(err as Error).message}`,
        (err as Error).stack,
      );
      await this.messaging.sendText(
        chatId,
        this.i18n.get('queries.recent_error'),
        { parseMode: 'MarkdownV2' },
      );
    }
  }

  async handleMonthlySummary(chatId: string): Promise<void> {
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const summary = await this.sheets.getMonthlySummary(yearMonth);
      const monthName = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      ).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
      const title = this.i18n.get('queries.summary_title', {
        month: this.escape(monthName),
      });

      const total = `💰 Total: *\\$${this.escape(this.formatAmount(summary.total))}*`;
      const count = `🧾 Transacciones: *${String(summary.count)}*`;

      const entries = Object.entries(summary.byCategory);
      entries.sort((a, b) => b[1] - a[1]);
      const rows = entries.map(([cat, amt]) => {
        const amount = `\\$${this.escape(this.formatAmount(amt))}`;
        return `${this.escape(cat)}  ·  *${amount}*`;
      });

      const sections = [
        title,
        DIVIDER,
        total,
        count,
        ...(rows.length ? [DIVIDER, this.i18n.get('queries.summary_by_categoria'), '', ...rows] : []),
      ];
      await this.step.send(chatId, sections.join('\n'), {
        parseMode: 'MarkdownV2',
      });
    } catch (err) {
      this.logger.error(
        `Monthly summary error: ${(err as Error).message}`,
        (err as Error).stack,
      );
      await this.messaging.sendText(
        chatId,
        this.i18n.get('queries.summary_error'),
        { parseMode: 'MarkdownV2' },
      );
    }
  }
}
