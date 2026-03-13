# Expense Bot

A Telegram bot to track business expenses, review recent records, and generate monthly summaries.
The project is built with NestJS and uses Google Sheets as a lightweight data store.

## What It Does

- Records manual expenses with a guided step-by-step flow.
- Processes invoice/receipt photos and extracts data with AI.
- Accepts voice notes and transcribes them to continue the normal bot flow.
- Saves each expense to Google Sheets.
- Uploads images to Google Drive and stores a public link.
- Answers queries for recent expenses and monthly summaries by category.

## Stack and Architecture

- **Framework:** NestJS (TypeScript)
- **Bot:** `node-telegram-bot-api` (webhook or polling, env-driven)
- **AI:** chained connectors (Gemini primary, OpenAI fallback)
- **Persistence:** Google Sheets API
- **Files:** Google Drive API
- **Logs:** `nestjs-pino`
- **Config:** `@nestjs/config` + Joi validation

Main modules:

- `TelegramModule`: message/callback input and intent routing.
- `AiModule`: intent classification, receipt OCR, and audio transcription.
- `GoogleModule`: auth, Sheets read/write, and Drive uploads.
- `ConversationModule`: per-chat conversation state.
- `I18nModule`: bot text/messages.

## Environment Variables

Create a `.env` file in the project root:

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

Notes:

- `TELEGRAM_TRANSPORT` supports `polling` or `webhook`.
- `TELEGRAM_WEBHOOK_URL` is required when `TELEGRAM_TRANSPORT=webhook` (for example: `https://your-domain.com/telegram/webhook`).
- `TELEGRAM_WEBHOOK_SECRET` is optional but recommended for webhook security.
- In webhook mode, the URL must be `https://.../telegram/webhook` (validated at startup).
- `OPENAI_API_KEY` is optional (fallback).
- `GOOGLE_PRIVATE_KEY` must preserve line breaks (`\n`) if provided as a single-line value.
- `GOOGLE_DRIVE_FOLDER_ID` is optional; if omitted, uploads use the available Drive location for the account.

## Install and Run

```bash
pnpm install
pnpm start:dev
```

Other useful scripts:

```bash
pnpm build
pnpm start:prod
pnpm lint
pnpm test
pnpm test:e2e
pnpm telegram:webhook:info
```

## Telegram Commands

- `/start`: show main menu.
- `/gasto` or `/expense`: start manual expense entry.
- `/factura` or `/receipt`: start receipt image flow.
- `/gastos` or `/expenses`: show recent expenses.
- `/mes` or `/month`: show monthly summary.
- `/cancel` or `/cancelar`: cancel the active flow.

## Functional Flow (Summary)

1. User sends text, image, or voice.
2. `TelegramDispatcher` routes by command/state/intent.
3. For image or voice, `AiService` extracts/transcribes content.
4. Missing data is confirmed or completed with the user.
5. Expense is saved to `Google Sheets` and image is uploaded to `Google Drive` when applicable.

## Development Conventions

- This project uses `pnpm`.
- Husky is configured to sanitize commit messages and remove unwanted trailers (`Co-authored-by`, `Made by`).
