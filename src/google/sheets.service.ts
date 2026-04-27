import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4, Auth } from 'googleapis';
import { GOOGLE_AUTH } from './google-auth.provider';
import {
  Expense,
  MonthlySummary,
} from '../shared/interfaces/expense.interface';

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

@Injectable()
export class SheetsService implements OnModuleInit {
  private readonly logger = new Logger(SheetsService.name);
  private sheets: sheets_v4.Sheets;
  private readonly sheetId: string | undefined;

  constructor(
    @Inject(GOOGLE_AUTH) private readonly auth: Auth.GoogleAuth,
    private readonly config: ConfigService,
  ) {
    this.sheetId = this.config.get<string>('GOOGLE_SHEET_ID');
  }

  async onModuleInit() {
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  private canonicalTabName(yearMonth?: string): { canonical: string; normalized: string } {
    let date: Date;
    if (yearMonth) {
      const [y, m] = yearMonth.split('-').map(Number);
      date = new Date(y, m - 1, 1);
    } else {
      date = new Date();
    }
    const month = MONTHS_ES[date.getMonth()];
    const year = date.getFullYear();
    const capitalized = month.charAt(0).toUpperCase() + month.slice(1);
    return {
      canonical: `Gastos ${capitalized} ${year}`,
      normalized: `gastos ${month} ${year}`,
    };
  }

  private async getSheetTabName(yearMonth?: string): Promise<string> {
    const { canonical, normalized } = this.canonicalTabName(yearMonth);
    try {
      const meta = await this.sheets.spreadsheets.get({ spreadsheetId: this.sheetId });
      const tabs = (meta.data.sheets ?? []).map(s => s.properties?.title ?? '').filter(Boolean);
      const found = tabs.find(t => t.toLowerCase().replace(/\s+/g, ' ') === normalized);
      if (found) return found;
    } catch (e) {
      this.logger.warn('Could not list sheet tabs: ' + (e as Error).message);
    }
    return canonical;
  }

  private async getOrCreateTab(yearMonth?: string): Promise<string> {
    const { canonical, normalized } = this.canonicalTabName(yearMonth);
    let existingTab: string | undefined;

    try {
      const meta = await this.sheets.spreadsheets.get({ spreadsheetId: this.sheetId });
      const tabs = (meta.data.sheets ?? []).map(s => s.properties?.title ?? '').filter(Boolean);
      existingTab = tabs.find(t => t.toLowerCase().replace(/\s+/g, ' ') === normalized);
    } catch (e) {
      this.logger.warn('Could not list sheet tabs: ' + (e as Error).message);
    }

    if (existingTab) return existingTab;

    const tabName = canonical;
    this.logger.log(`Creating new tab: "${tabName}"`);
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range: `'${tabName}'!A1:G1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Fecha', 'Proveedor', 'Categoria', 'Description', 'Valor', 'Metodo', 'Por']] },
    });
    return tabName;
  }

  private getMonthsInRange(fromDate?: string, toDate?: string): string[] {
    const now = new Date();
    const from = fromDate
      ? new Date(fromDate.slice(0, 7) + '-01')
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = toDate
      ? new Date(toDate.slice(0, 7) + '-01')
      : new Date(now.getFullYear(), now.getMonth(), 1);

    const months: string[] = [];
    const cur = new Date(from);
    while (cur <= to) {
      months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
      cur.setMonth(cur.getMonth() + 1);
    }
    return months.length ? months : [`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`];
  }

  /** Convert a Sheets cell value to YYYY-MM-DD string. */
  private toDateString(val: unknown): string {
    if (typeof val === 'number') {
      const ms = (val - 25569) * 86400 * 1000;
      return new Date(ms).toISOString().split('T')[0];
    }
    return typeof val === 'string' ? val : '';
  }

  private rowToExpense(r: string[]): Expense {
    return {
      date: this.toDateString(r[0]),
      provider: r[1] || '',
      category: r[2] || '',
      reason: r[3] || '',
      amount: parseFloat(r[4]) || 0,
      method: r[5] || '',
      by: r[6] || '',
    };
  }

  async appendExpense(e: Expense): Promise<void> {
    const yearMonth = e.date ? e.date.slice(0, 7) : undefined;
    const tab = await this.getOrCreateTab(yearMonth);
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.sheetId,
      range: `'${tab}'!A:G`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          e.date,
          e.provider,
          e.category || '',
          e.reason || '',
          e.amount,
          e.method || '',
          e.by || '',
        ]],
      },
    });
  }

  async getLastExpenses(n = 5): Promise<Expense[]> {
    const tab = await this.getSheetTabName();
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: `'${tab}'!A:G`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = (res.data.values || []) as string[][];
    return rows.slice(1).slice(-n).reverse().map(r => this.rowToExpense(r));
  }

  async getExpenses(
    filters: {
      fromDate?: string;
      toDate?: string;
      reason?: string;
      category?: string;
    } = {},
  ): Promise<Expense[]> {
    const months = this.getMonthsInRange(filters.fromDate, filters.toDate);
    const all: Expense[] = [];

    for (const ym of months) {
      const tab = await this.getSheetTabName(ym);
      try {
        const res = await this.sheets.spreadsheets.values.get({
          spreadsheetId: this.sheetId,
          range: `'${tab}'!A:G`,
          valueRenderOption: 'UNFORMATTED_VALUE',
        });
        const rows = (res.data.values || []) as string[][];
        all.push(...rows.slice(1).map(r => this.rowToExpense(r)));
      } catch (e) {
        this.logger.warn(`Could not read tab "${tab}": ${(e as Error).message}`);
      }
    }

    return all.filter(e => {
      if (filters.fromDate && e.date < filters.fromDate) return false;
      if (filters.toDate && e.date > filters.toDate) return false;
      if (filters.reason && !e.reason.toLowerCase().includes(filters.reason.toLowerCase())) return false;
      if (filters.category && e.category !== filters.category) return false;
      return true;
    });
  }

  async getMonthlySummary(yearMonth: string): Promise<MonthlySummary> {
    const tab = await this.getSheetTabName(yearMonth);
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: `'${tab}'!A:G`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = (res.data.values || []) as string[][];
    const data = rows.slice(1).filter(r => this.toDateString(r[0]).startsWith(yearMonth));

    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const r of data) {
      const cat = r[2] || 'Sin categoria';
      const amt = parseFloat(r[4]) || 0;
      byCategory[cat] = (byCategory[cat] || 0) + amt;
      total += amt;
    }
    return { month: yearMonth, total, byCategory, count: data.length };
  }
}
