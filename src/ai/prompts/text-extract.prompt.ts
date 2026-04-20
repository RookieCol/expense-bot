/**
 * Prompt for extracting structured expense data from free-form text
 * (typically a voice-note transcription). Categories come from the Zod
 * schema — no need to repeat the allowed values in the prompt.
 */
export const textExtractPrompt = (text: string): string => {
  const today = new Date().toISOString().split('T')[0];
  return `Extract expense details from this description. Today is ${today}. Use today's date if no date is mentioned. If a field cannot be determined, return an empty string (or 0 for the amount).

Description: "${text}"`;
};
