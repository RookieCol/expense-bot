import { z } from 'zod';

export const INTENTS = [
  'MANUAL_EXPENSE',
  'QUERY_EXPENSES',
  'MONTHLY_SUMMARY',
  'GREETING',
  'UNKNOWN',
] as const;

export type Intent = (typeof INTENTS)[number];

export const IntentSchema = z.object({
  intent: z
    .enum(INTENTS)
    .describe('The classified intent. Use UNKNOWN when unsure.'),
});
