import { z } from 'zod';
import { CATEGORIES } from '../../shared/categories';

// Derive enum values from the single source of truth (shared/categories).
// This eliminates the duplicated category list that used to live inline
// in the OpenRouter prompt and in shared/categories.
const categoryValues = CATEGORIES.map((c) => c.value) as [string, ...string[]];

export const ExpenseExtractionSchema = z.object({
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(
      'Date in YYYY-MM-DD format. Use today if the receipt date is not clearly visible.',
    ),
  proveedor: z
    .string()
    .describe('Business / vendor name. Empty string if unreadable.'),
  categoria: z
    .enum(categoryValues)
    .describe('Expense category. Pick the closest match.'),
  descripcion: z.string().describe('Brief description of what was purchased.'),
  monto: z
    .number()
    .nonnegative()
    .describe('Total amount in local currency. 0 if unreadable.'),
});

export type ExpenseExtraction = z.infer<typeof ExpenseExtractionSchema>;
