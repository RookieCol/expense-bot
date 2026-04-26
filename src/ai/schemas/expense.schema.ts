import { z } from 'zod';

export const ExpenseExtractionSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(
      'Date in YYYY-MM-DD format. Use today if the receipt date is not clearly visible.',
    ),
  provider: z
    .string()
    .describe('Business / vendor name. Empty string if unreadable.'),
  category: z
    .enum(['Compras', 'Pagos', 'Sueldos', 'Transporte'])
    .describe('Expense category. Pick the closest match.'),
  reason: z
    .string()
    .describe('Brief reason or purpose of the expense — what was purchased.'),
  amount: z
    .number()
    .nonnegative()
    .describe('Total amount in local currency. 0 if unreadable.'),
  method: z
    .string()
    .optional()
    .describe(
      'Payment method if visible on the receipt (e.g. Efectivo, Tarjeta, Transferencia). Empty if not shown.',
    ),
});

export type ExpenseExtraction = z.infer<typeof ExpenseExtractionSchema>;
