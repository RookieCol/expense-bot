import type { ModelMessage } from 'ai';

/**
 * Prompt for extracting structured expense data from a receipt photo.
 * The image is sent as a Buffer; the AI SDK handles base64 encoding
 * per-provider. Categories are enforced by the Zod schema, not the
 * prompt, so they stay in sync with CATEGORIES automatically.
 */
export const receiptExtractPrompt = (image: Buffer): ModelMessage[] => {
  const today = new Date().toISOString().split('T')[0];
  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Extract the expense data from this receipt. Today is ${today}. Use today's date if the receipt date is not clearly visible. If a field is unreadable, return an empty string (or 0 for the amount).`,
        },
        { type: 'image', image },
      ],
    },
  ];
};
