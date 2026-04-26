export interface Expense {
  date: string;
  provider: string;
  category: string;
  reason: string;
  amount: number;
  method?: string;
  by?: string;
}

export interface MonthlySummary {
  month: string;
  total: number;
  byCategory: Record<string, number>;
  count: number;
}
