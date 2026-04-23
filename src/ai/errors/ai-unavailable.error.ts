export type AiTask =
  | 'extract-image'
  | 'extract-text'
  | 'transcribe-audio';

/**
 * Thrown by AiService when every configured connector has failed for a
 * given task. Callers catch this to show a user-facing "try again or
 * fill in manually" message instead of silently proceeding with empty
 * defaults (the old behavior left users staring at a blank confirmation
 * card with no signal that extraction had failed).
 */
export class AiUnavailableError extends Error {
  constructor(
    public readonly task: AiTask,
    public readonly lastError?: Error,
  ) {
    super(
      `AI task "${task}" unavailable${
        lastError ? `: ${lastError.message}` : ''
      }`,
    );
    this.name = 'AiUnavailableError';
  }
}
