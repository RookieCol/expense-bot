# Expense Bot (Webhook-Ready)

Telegram bot to register business expenses, process receipts/voice notes with AI, and save records in Google Sheets.

This app now supports a modern transport model:

- **Webhook-first** for production.
- **Polling fallback** for local development.

## Features

- Guided manual expense registration.
- Receipt image parsing with AI.
- Voice note transcription for chat flow continuation.
- Google Sheets write/read for expense history.
- Google Drive upload for receipt images.
- Recent expenses and monthly summary queries.

## Architecture

- **Backend:** NestJS + TypeScript
- **Telegram transport:** `node-telegram-bot-api` (`webhook` or `polling`)
- **AI:** Gemini primary + OpenAI fallback connector chain
- **Storage:** Google Sheets API
- **File hosting:** Google Drive API
- **Logging:** `nestjs-pino`
- **Config validation:** Joi

Main modules:

- `TelegramModule`: receives Telegram updates and routes commands/callbacks/intents.
- `AiModule`: intent classification, OCR, and audio transcription.
- `GoogleModule`: shared auth, Sheets operations, Drive uploads.
- `ConversationModule`: per-chat conversational state.
- `I18nModule`: response text catalog.

## Environment Variables

Create `.env` at project root:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_TRANSPORT=polling
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBHOOK_SECRET=
GEMINI_API_KEY=
OPENAI_API_KEY=
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SHEET_ID=
GOOGLE_DRIVE_FOLDER_ID=
PORT=3000
```

Rules:

- `TELEGRAM_TRANSPORT` can be `polling` or `webhook`.
- `TELEGRAM_WEBHOOK_URL` is required when transport is `webhook`.
- Webhook URL must be `https://<domain>/telegram/webhook` (validated at startup).
- `TELEGRAM_WEBHOOK_SECRET` is optional but strongly recommended.
- `OPENAI_API_KEY` is optional (fallback only).
- Keep `GOOGLE_PRIVATE_KEY` line breaks (`\n`) if provided as single-line text.

## Setup with BotFather

1. Create/select your bot in `@BotFather`.
2. Copy the bot token from **API Token**.
3. Put token into `TELEGRAM_BOT_TOKEN` in `.env`.
4. You do not need to manually set webhook in BotFather UI; the app configures it via Bot API on startup.

## Run

```bash
pnpm install
pnpm start:dev
```

Useful scripts:

```bash
pnpm build
pnpm start:prod
pnpm lint
pnpm test
pnpm test:e2e
pnpm telegram:webhook:info
```

## Production Webhook Checklist

- App is publicly reachable over HTTPS.
- Domain resolves correctly to your server.
- `TELEGRAM_TRANSPORT=webhook`.
- `TELEGRAM_WEBHOOK_URL=https://<domain>/telegram/webhook`.
- `TELEGRAM_WEBHOOK_SECRET` set in env and expected by server.
- Verify status with `pnpm telegram:webhook:info`.

## Telegram Commands

- `/start`: show main menu.
- `/gasto` or `/expense`: start manual expense entry.
- `/factura` or `/receipt`: start receipt flow.
- `/gastos` or `/expenses`: show recent expenses.
- `/mes` or `/month`: show monthly summary.
- `/cancel` or `/cancelar`: cancel active flow.

## Message Flow

1. User sends text, photo, or voice.
2. `TelegramDispatcher` routes by command/state/intent.
3. For voice/image input, `AiService` transcribes/extracts data.
4. Bot asks for missing fields if needed.
5. Expense is stored in Sheets and optional receipt link is stored from Drive upload.

## Development Notes

- Package manager: `pnpm`.
- Husky sanitizes commit messages by removing `Co-authored-by` and `Made by` trailers.
