# Expense Bot (Webhook-Ready)

Telegram bot for business expense tracking with AI-powered receipt extraction and voice transcription, persisted to Google Sheets (with optional Google Drive receipt links).

## Overview

- **Backend:** NestJS + TypeScript
- **Transport:** Telegram Bot API (`polling` or `webhook`)
- **AI Provider:** OpenRouter (single connector)
- **Storage:** Google Sheets API
- **File Hosting:** Google Drive API (optional)
- **Logging:** `nestjs-pino`
- **Config Validation:** Joi

## Features

- Guided manual expense registration
- Receipt photo parsing (structured extraction)
- Voice note transcription for conversational flow
- Recent expenses and monthly summary queries
- Google Sheets persistence
- Optional Drive upload for receipt images

## Environment Variables

Create `.env` in project root:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_TRANSPORT=polling
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBHOOK_SECRET=

OPENROUTER_API_KEY=

GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SHEET_ID=
GOOGLE_DRIVE_FOLDER_ID=

PORT=3000
```

### Validation Rules

- `TELEGRAM_BOT_TOKEN`: required
- `TELEGRAM_TRANSPORT`: `polling` or `webhook` (default: `polling`)
- `TELEGRAM_WEBHOOK_URL`: required when `TELEGRAM_TRANSPORT=webhook`
- `TELEGRAM_WEBHOOK_SECRET`: optional (recommended)
- `OPENROUTER_API_KEY`: required
- `GOOGLE_CLIENT_EMAIL`: required
- `GOOGLE_PRIVATE_KEY`: required
- `GOOGLE_SHEET_ID`: required
- `GOOGLE_DRIVE_FOLDER_ID`: optional
- `PORT`: optional (default: `3000`)

If `GOOGLE_PRIVATE_KEY` is stored in one line, keep escaped line breaks (`\n`).

## Telegram Transport Modes

### Polling (Local Development)

```bash
pnpm install
pnpm start:dev
```

Use `TELEGRAM_TRANSPORT=polling`.

### Webhook (Production or Local ngrok Testing)

Use:

- `TELEGRAM_TRANSPORT=webhook`
- `TELEGRAM_WEBHOOK_URL=https://<domain>/telegram/webhook`

Requirements:

- HTTPS endpoint
- Exact webhook path: `/telegram/webhook`

The application registers the webhook automatically on startup.

## Setup

1. Create your bot in `@BotFather` and obtain `TELEGRAM_BOT_TOKEN`.
2. Create a Google service account with Sheets and Drive access.
3. Share target spreadsheet with `GOOGLE_CLIENT_EMAIL`.
4. Set all required environment variables.

## Scripts

```bash
pnpm start:dev
pnpm build
pnpm start:prod
pnpm lint
pnpm test
pnpm test:e2e
pnpm telegram:webhook:info
```

## Telegram Commands

- `/start` - show main menu
- `/gasto` or `/expense` - start manual expense flow
- `/factura` or `/receipt` - start receipt flow
- `/gastos` or `/expenses` - list recent expenses
- `/mes` or `/month` - show monthly summary
- `/cancel` or `/cancelar` - cancel current flow

## Runtime Flow

1. User sends text, photo, or voice.
2. Dispatcher routes by command, state, and intent.
3. OpenRouter connector handles image extraction, intent classification, and audio transcription.
4. Missing fields are requested interactively.
5. Expense is saved to Sheets; receipt link is added when available.
