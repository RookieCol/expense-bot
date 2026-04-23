import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4, Auth } from 'googleapis';
import { GOOGLE_AUTH } from './google-auth.provider';
import {
  Expense,
  MonthlySummary,
} from '../shared/interfaces/expense.interface';

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
    await this.ensureHeaders();
  }

  private async ensureHeaders() {
    try {
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: 'A1:G1',
      });
      if (!res.data.values?.length) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.sheetId,
          range: 'A1:G1',
          valueInputOption: 'RAW',
          requestBody: {
            values: [
              [
                'date',
                'provider',
                'category',
                'description',
                'amount',
                'receipt_link',
                'registered_by',
              ],
            ],
          },
        });
      }
    } catch (e) {
      this.logger.warn('Could not verify headers: ' + (e as Error).message);
    }
  }

  /** Convert a Sheets cell value to YYYY-MM-DD string.
   * UNFORMATTED_VALUE returns date cells as serial numbers (days since 1899-12-30). */
  private toDateString(val: unknown): string {
    if (typeof val === 'number') {
      const ms = (val - 25569) * 86400 * 1000;
      return new Date(ms).toISOString().split('T')[0];
    }
    return typeof val === 'string' ? val : '';
  }

  async appendExpense(e: Expense): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.sheetId,
      range: 'A:G',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [
            e.fecha,
            e.proveedor,
            e.categoria,
            e.descripcion,
            e.monto,
            e.facturaLink || '',
            e.registradoPor || '',
          ],
        ],
      },
    });
  }

  async getLastExpenses(n = 5): Promise<Expense[]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: 'A:F',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = (res.data.values || []) as string[][];
    return rows
      .slice(1)
      .slice(-n)
      .reverse()
      .map((r) => ({
        fecha: this.toDateString(r[0]),
        proveedor: r[1] || '',
        categoria: r[2] || '',
        descripcion: r[3] || '',
        monto: parseFloat(r[4]) || 0,
        facturaLink: r[5] || '',
      }));
  }

  /**
   * Flexible query used by the insights agent as a tool. Every filter
   * is optional — passing none returns every expense on record.
   */
  async getExpenses(
    filters: {
      fromDate?: string; // YYYY-MM-DD inclusive
      toDate?: string; // YYYY-MM-DD inclusive
      category?: string;
    } = {},
  ): Promise<Expense[]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: 'A:F',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = (res.data.values || []) as string[][];
    return rows
      .slice(1)
      .map((r) => ({
        fecha: this.toDateString(r[0]),
        proveedor: r[1] || '',
        categoria: r[2] || '',
        descripcion: r[3] || '',
        monto: parseFloat(r[4]) || 0,
        facturaLink: r[5] || '',
      }))
      .filter((e) => {
        if (filters.fromDate && e.fecha < filters.fromDate) return false;
        if (filters.toDate && e.fecha > filters.toDate) return false;
        if (filters.category && e.categoria !== filters.category) return false;
        return true;
      });
  }

  async getMonthlySummary(yearMonth: string): Promise<MonthlySummary> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: 'A:F',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const allRows = (res.data.values || []) as string[][];
    const rows = allRows
      .slice(1)
      .filter((r) => this.toDateString(r[0]).startsWith(yearMonth));
    const porCategoria: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const cat: string = r[2] || 'Other';
      const amt = parseFloat(r[4]) || 0;
      porCategoria[cat] = (porCategoria[cat] || 0) + amt;
      total += amt;
    }
    return { mes: yearMonth, total, porCategoria, cantidadGastos: rows.length };
  }
}
