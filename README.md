# Expense Bot

Telegram bot for business expense tracking. Parses receipts from photos, transcribes voice notes, and persists everything to Google Sheets.

## Stack

| Layer | Tech |
|-------|------|
| Backend | NestJS + TypeScript |
| Telegram | Bot API — polling or webhook |
| AI | OpenRouter (`@openrouter/sdk`) |
| Storage | Google Sheets API |
| File hosting | Google Drive API (optional) |
| Logging | nestjs-pino |

## Features

- **Photo receipts** — send a photo, the bot extracts date, vendor, category, description, and amount
- **Voice notes** — transcribed and parsed for expense intent
- **Manual entry** — guided conversational flow for manual expense registration
- **Queries** — recent expenses and monthly summary by category
- **Google Sheets** — every expense persisted with optional Drive link for the original receipt image

## AI Architecture

All AI tasks go through a single OpenRouter connector with per-task model selection and automatic fallback:

| Task | Primary | Fallback |
|------|---------|----------|
| Receipt extraction (image) | `google/gemini-2.0-flash` | `openai/gpt-4o-mini` |
| Intent classification (text) | `openai/gpt-4o-mini` | `google/gemini-2.0-flash` |
| Voice transcription (audio) | `google/gemini-2.0-flash` | `google/gemini-1.5-flash` |

If the primary model fails (rate limit, timeout, etc.), the next model is tried automatically. If all models fail, the bot falls back to a safe default and prompts the user to fill in fields manually.

## Setup

### 1. Telegram bot

Create a bot via `@BotFather` and copy the token.

### 2. Google service account

1. Create a service account in Google Cloud Console.
2. Enable **Sheets API** and **Drive API** (Drive is optional).
3. Download the JSON key — you need `client_email` and `private_key`.
4. Share your target spreadsheet with the `client_email`.

### 3. OpenRouter API key

Get a key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). The free tier is enough for low-volume use.

### 4. Environment variables

Create `.env` in the project root:

```env
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_TRANSPORT=polling          # polling | webhook
TELEGRAM_WEBHOOK_URL=               # required if TRANSPORT=webhook
TELEGRAM_WEBHOOK_SECRET=            # optional but recommended

# AI
OPENROUTER_API_KEY=

# Google
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=                 # keep \n escapes on a single line
GOOGLE_SHEET_ID=
GOOGLE_DRIVE_FOLDER_ID=             # optional

# Server
PORT=3000
```

## Running

```bash
pnpm install

# Development (polling)
pnpm start:dev

# Production build
pnpm build
pnpm start:prod
```

## Telegram Transport

### Polling (local dev)

Set `TELEGRAM_TRANSPORT=polling`. No public URL needed.

### Webhook (production / ngrok)

Set:
```env
TELEGRAM_TRANSPORT=webhook
TELEGRAM_WEBHOOK_URL=https://<your-domain>/telegram/webhook
```

The app registers the webhook automatically on startup. Requires HTTPS and the exact path `/telegram/webhook`.

To inspect the current webhook state:
```bash
pnpm telegram:webhook:info
```

## Commands

| Command | Alias | Action |
|---------|-------|--------|
| `/start` | — | Show main menu |
| `/gasto` | `/expense` | Start manual expense flow |
| `/factura` | `/receipt` | Start receipt photo flow |
| `/gastos` | `/expenses` | List recent expenses |
| `/mes` | `/month` | Monthly summary by category |
| `/cancel` | `/cancelar` | Cancel current flow |

## How it works

```
User sends message (text / photo / voice)
        ↓
Dispatcher routes by command, conversation state, or AI intent
        ↓
OpenRouter connector handles extraction / classification / transcription
        ↓
Missing fields requested interactively
        ↓
Expense saved to Google Sheets (+ Drive link if photo)
```

## Scripts

```bash
pnpm start:dev          # watch mode
pnpm build              # compile to dist/
pnpm start:prod         # run compiled build
pnpm test               # unit tests
pnpm lint               # eslint
pnpm telegram:webhook:info  # inspect registered webhook
```
