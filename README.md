# Expense Bot

Multi-channel bot for business expense tracking. Available on **Telegram** and **WhatsApp** (via Twilio). Parses receipts from photos, transcribes voice notes, and persists everything to Google Sheets.

## Stack

| Layer | Tech |
|-------|------|
| Backend | NestJS + TypeScript |
| Telegram | `node-telegram-bot-api` — polling or webhook |
| WhatsApp | `twilio` SDK — webhook, Content API for interactive UI |
| AI | OpenRouter (`@openrouter/sdk`) |
| Storage | Google Sheets API |
| File hosting | Google Drive API (optional) |
| Audio conversion | ffmpeg (system binary) |

## Features

- **Photo receipts** — send a photo, the bot extracts date, vendor, category, description and amount
- **Voice notes** — OGG converted to MP3 via ffmpeg, transcribed and parsed into a complete expense
- **Manual entry** — guided step-by-step flow; all prompts are cleaned up when the summary appears (Telegram)
- **Edit before saving** — from the confirmation screen, edit any field without restarting the flow
- **Queries** — recent expenses and monthly summary by category, mobile-friendly layout
- **Google Sheets** — every expense persisted with optional Drive link for the receipt image; includes the user that registered it
- **Cross-channel identity** — `/vincular` command links a Telegram user's phone to their WhatsApp number so both channels share the same history

## Architecture

The messaging layer is decoupled from the business logic through a `MessagingPort` interface. Both Telegram and WhatsApp modules provide their own adapter instance bound to `MESSAGING_PORT`, so handlers are platform-agnostic.

```
src/
├── shared/messaging/         MessagingPort interface + MESSAGING_PORT DI token
├── conversation/             In-memory conversation state (string-keyed chatIds)
├── ai/                       OpenRouter connector with fallback
├── google/                   Sheets + Drive services
├── telegram/
│   ├── telegram.adapter.ts   Implements MessagingPort via node-telegram-bot-api
│   ├── telegram.dispatcher   Routes commands, callbacks, voice, NLP intent
│   ├── telegram.service      Bot init (polling / webhook)
│   ├── handlers/             Menu, Expense, Receipt, Query (platform-agnostic)
│   └── step-messenger        Auto-cleanup of intermediate messages
└── whatsapp/
    ├── whatsapp.adapter      Implements MessagingPort via Twilio
    ├── whatsapp.dispatcher   Parses Twilio payloads, routes to shared handlers
    ├── whatsapp-webhook      POST /whatsapp/webhook (Twilio signature validated)
    ├── whatsapp-templates    Content template definitions (quick-reply + list-picker)
    ├── whatsapp-template.service   Idempotent provisioning of templates
    └── phone-link            Cross-channel identity mapping
```

Both adapters translate the same `MessagingPort` calls (`sendText`, `sendMenu`, `deleteMessage`, `sendPhoto`) into their respective platform APIs. Telegram maps menus to inline keyboards; WhatsApp maps them to native quick-reply or list-picker templates.

## AI Architecture

All AI tasks go through a single OpenRouter connector with per-task model selection and automatic fallback:

| Task | Primary | Fallback |
|------|---------|----------|
| Receipt extraction (image) | `google/gemini-2.0-flash-001` | `openai/gpt-4o-mini` |
| Text extraction (voice transcript) | `google/gemini-2.0-flash-001` | `openai/gpt-4o-mini` |
| Intent classification | `openai/gpt-4o-mini` | `google/gemini-2.0-flash-001` |
| Voice transcription (audio) | `openai/gpt-audio-mini` | `google/gemini-2.5-flash-lite` |

If the primary model fails (rate limit, timeout, etc.), the next model is tried automatically. If all models fail, the bot falls back to a safe default and prompts the user to fill in fields manually.

## Setup

### 1. Telegram bot

Create a bot via `@BotFather` and copy the token.

### 2. WhatsApp via Twilio (optional)

1. Sign up at [twilio.com](https://www.twilio.com) and activate the **WhatsApp sandbox** (Messaging → Try it out → Send a WhatsApp message).
2. Copy your `Account SID` and `Auth Token` from the console.
3. Join the sandbox by sending the displayed `join <code>` message from your WhatsApp to the sandbox number (`+1 415 523 8886`).
4. On first startup the bot auto-creates 5 content templates (`MAIN_MENU`, `METHOD_MENU`, `CATEGORY_MENU`, `CONFIRM_MENU`, `EDIT_MENU`). These are idempotent — restarts reuse the existing SIDs by `friendlyName`.

### 3. Google service account

1. Create a service account in Google Cloud Console.
2. Enable **Sheets API** and **Drive API** (Drive is optional).
3. Download the JSON key — you need `client_email` and `private_key`.
4. Share your target spreadsheet with the `client_email`.

### 4. OpenRouter API key

Get a key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). The free tier is enough for low-volume use.

### 5. ffmpeg

Required for voice note transcription (OGG → MP3 conversion):

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
apt install ffmpeg
```

### 6. Environment variables

Create `.env` in the project root:

```env
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_TRANSPORT=polling          # polling | webhook
TELEGRAM_WEBHOOK_URL=               # required if TRANSPORT=webhook
TELEGRAM_WEBHOOK_SECRET=            # optional but recommended

# WhatsApp via Twilio (optional)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
WHATSAPP_WEBHOOK_URL=               # used for Twilio signature validation

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

## Transports

### Telegram — polling (local dev)

Set `TELEGRAM_TRANSPORT=polling`. No public URL needed.

### Telegram — webhook (production / ngrok)

```env
TELEGRAM_TRANSPORT=webhook
TELEGRAM_WEBHOOK_URL=https://<your-domain>/telegram/webhook
```

The app registers the webhook automatically on startup. Requires HTTPS and the exact path `/telegram/webhook`.

Inspect the current webhook state:
```bash
pnpm telegram:webhook:info
```

### WhatsApp — webhook only

Twilio delivers messages via webhook. Configure the inbound URL in the Twilio console:

**Messaging → Try it out → WhatsApp sandbox settings → "When a message comes in"**

```
https://<your-domain>/whatsapp/webhook   (method: POST)
```

The bot verifies the `X-Twilio-Signature` header when `WHATSAPP_WEBHOOK_URL` is set.

## Commands

| Command | Alias | Action |
|---------|-------|--------|
| `/start` | — | Show main menu (Telegram also cleans previous messages) |
| `/gasto` | `/expense` | Start manual expense flow |
| `/gastos` | `/expenses` | List recent expenses |
| `/mes` | `/month` | Monthly summary by category |
| `/vincular` | — | (Telegram only) Link phone number for cross-channel identity |
| `/cancel` | `/cancelar` | Cancel current flow |

## Platform differences

| Capability | Telegram | WhatsApp |
|------------|----------|----------|
| Inline menus | Inline keyboard | Quick-reply buttons (≤3) / list-picker (≤10) |
| Message deletion | Yes (auto-cleanup) | No-op (WhatsApp limitation) |
| Edit message | Yes | Sends new message |
| Photo receipts | Yes | Yes |
| Voice notes | Yes | Yes |
| Bold | `*bold*` (MarkdownV2 escaped) | `*bold*` (adapter strips escapes) |
| Numbered fallback | — | Yes, if template send fails |

The `MessagingPort` abstraction hides these differences from handlers. Adapters do the translation.

## Message lifecycle (Telegram)

- **Manual flow prompts** — deleted when the confirmation summary appears
- **User messages** during manual entry — deleted with the prompts
- **Loading spinners** — deleted immediately after the operation completes
- **Edit overlays** — deleted when returning to the confirmation screen
- **Confirmation summary** — deleted when the user confirms or cancels
- **"✅ Gasto guardado"** — kept as permanent history
- **Query results** — replace the previous query result; kept until the next query or `/start`

WhatsApp keeps every message visible since the platform does not allow the bot to delete its own messages.

## How it works

```
User sends message (text / photo / voice / button tap)
        ↓
Platform-specific webhook (TelegramWebhookController / WhatsAppWebhookController)
        ↓
Dispatcher routes by command, callback payload, media type, or conversation state
        ↓
Handlers operate via MessagingPort (platform-agnostic)
        ↓
OpenRouter connector handles extraction / classification / transcription
        ↓
Expense saved to Google Sheets (+ Drive link if photo)
```

## Scripts

```bash
pnpm start:dev                 # watch mode
pnpm build                     # compile to dist/
pnpm start:prod                # run compiled build
pnpm test                      # unit tests
pnpm lint                      # eslint
pnpm telegram:webhook:info     # inspect registered Telegram webhook
```
