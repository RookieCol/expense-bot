/**
 * Prompt for classifying a free-text message into one of the bot's
 * known intents. The Zod schema enforces the allowed values, so the
 * prompt only needs to describe semantics, not enumerate options.
 */
export const intentClassifyPrompt = (text: string): string =>
  `Classify this message from a climbing-gym expense-bot user into one of the known intents.

Semantics:
- MANUAL_EXPENSE: the user wants to register a new expense manually
- QUERY_EXPENSES: the user wants to see recent expenses
- MONTHLY_SUMMARY: the user wants the monthly summary
- GREETING: the user is just saying hi or asking what the bot does
- UNKNOWN: anything else

Message: "${text}"`;
