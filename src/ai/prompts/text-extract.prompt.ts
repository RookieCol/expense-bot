/**
 * Prompt for extracting structured expense data from free-form text
 * (a voice transcription or a typed sentence). Categories come from
 * the Zod schema — no need to repeat the allowed values in the
 * prompt. Amount conventions are Colombian peso: "200 mil" = 200000,
 * "1.5 millones" = 1500000, "$45.000" = 45000.
 */
export const textExtractPrompt = (text: string): string => {
  const today = new Date().toISOString().split('T')[0];
  return `Extract expense details from this Spanish description. Today is ${today}. Use today's date if no date is mentioned. If a field cannot be determined, return an empty string (or 0 for the amount).

Amount conventions (Colombian pesos):
- "200 mil" / "doscientos mil" → 200000
- "1.5 millones" / "millon y medio" → 1500000
- "45000" / "$45.000" / "45.000 pesos" → 45000
- "50" / "cincuenta" → 50
Always output the amount as a number (no thousands separators, no currency symbol).

Description: "${text}"`;
};
