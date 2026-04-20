# WhatsApp Integration Design

**Date:** 2026-04-20  
**Status:** Approved  
**Approach:** MessagingPort adapter pattern (Option C)

---

## Overview

Add WhatsApp as a second contact channel via Twilio, running in parallel with the existing Telegram integration. Both channels share the same business logic (expense tracking, AI extraction, Google Sheets persistence) through a unified `MessagingPort` abstraction.

---

## Architecture

### Core Abstraction: `MessagingPort`

A new interface in `src/shared/messaging/` that handlers depend on instead of the Telegram bot directly:

```typescript
interface MessagingPort {
  sendText(chatId: string, text: string): Promise<SentMessage>;
  editText(chatId: string, messageId: string, text: string): Promise<SentMessage>;
  deleteMessage(chatId: string, messageId: string): Promise<void>;
  sendMenu(chatId: string, text: string, sections: MenuSection[]): Promise<SentMessage>;
  sendPhoto(chatId: string, url: string, caption?: string): Promise<SentMessage>;
}

interface SentMessage {
  messageId: string;
}

interface MenuSection {
  title: string;
  options: { id: string; label: string; description?: string }[];
}
```

### File Structure

```
src/
├── shared/
│   └── messaging/
│       ├── messaging-port.interface.ts   ← new
│       └── sent-message.interface.ts     ← new
├── telegram/
│   ├── telegram.adapter.ts               ← new: implements MessagingPort
│   └── ... (existing files, minimal changes)
└── whatsapp/                             ← new module
    ├── whatsapp.module.ts
    ├── whatsapp.service.ts
    ├── whatsapp-webhook.controller.ts
    ├── whatsapp.adapter.ts
    └── whatsapp.dispatcher.ts
```

### Message Flow

```
WhatsApp msg → WhatsAppWebhookController (validates Twilio signature)
                 → WhatsAppDispatcher (parses Twilio payload)
                 → Handler(chatId, msg, messagingPort: WhatsAppAdapter)
                 → ConversationService (shared state)
                 → Google Sheets (shared persistence)

Telegram msg  → TelegramDispatcher (refactored)
                 → Handler(chatId, msg, messagingPort: TelegramAdapter)
                 → ConversationService (shared state)
                 → Google Sheets (shared persistence)
```

---

## WhatsApp Module

### `WhatsAppWebhookController`
- Endpoint: `POST /whatsapp/webhook`
- Validates Twilio signature via `X-Twilio-Signature` header using `twilio` SDK validator
- Responds `200` immediately, processes async

### `WhatsAppAdapter` (implements `MessagingPort`)
- Initializes Twilio client on module init
- `sendText` → `messages.create({ body })`
- `sendMenu` → WhatsApp Interactive List Message via Twilio Content API
- `deleteMessage` → no-op (WhatsApp does not support message deletion by bots)
- `editText` → sends a new message (WhatsApp has no edit API)
- `sendPhoto` → `messages.create({ mediaUrl })`
- Injected into handlers via NestJS DI token `MESSAGING_PORT`

### `WhatsAppDispatcher`
- Same routing logic as `TelegramDispatcher`: commands, conversation states, NLP intent
- Parses Twilio webhook payload: extracts `chatId` from `From` field, `text` from `Body`, media from `MediaUrl0`/`MediaContentType0`

### Environment Variables (new)
```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
```

---

## Handler Refactoring

All four handlers (`MenuHandler`, `ExpenseHandler`, `ReceiptHandler`, `QueryHandler`) are updated to receive `MessagingPort` instead of `TelegramBot` directly.

**Before:**
```typescript
constructor(private readonly bot: TelegramBot) {}
await this.bot.sendMessage(chatId, text, { reply_markup: inlineKeyboard });
```

**After:**
```typescript
constructor(private readonly messaging: MessagingPort) {}
await this.messaging.sendMenu(chatId, text, sections);
```

`StepMessenger` also adapts to use `MessagingPort.deleteMessage()`. On WhatsApp, the adapter ignores the call silently.

---

## Unified Context by Phone Number

### `PhoneLinkService`
- Maintains in-memory map: `telegramChatId → phoneNumber`
- Populated when Telegram user shares contact via `/vincular` command
- `WhatsAppDispatcher` calls `resolveToCanonical(phone)` to find existing Telegram context

### `/vincular` Command (Telegram)
- Sends a "Share Contact" button
- On contact share: stores `telegramChatId → phoneNumber` in `PhoneLinkService`
- Both channels subsequently write to the same Google Sheet row/context

### Fallback
- WhatsApp users without a linked Telegram account get a fresh context using their phone number as `chatId`
- No feature loss, just no shared history

### Persistence
- Phone links are in-memory (same as conversation state)
- Future improvement: persist in Google Sheets

---

## Media Handling

### Photos (receipts)
- Twilio webhook includes `NumMedia` and `MediaUrl0`
- `WhatsAppDispatcher` detects `NumMedia > 0` → routes to `ReceiptHandler`
- Adapter downloads image from Twilio URL using `axios` with Basic Auth (`TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN`)
- Buffer passed to existing `AiService.extractFromImage()` — no changes to AI layer

### Voice Notes
- Twilio sends audio via `MediaUrl0` with `MediaContentType0: audio/*`
- Dispatcher detects audio content type → routes to voice flow
- Audio downloaded, converted OGG→MP3 via `ffmpeg` (already installed)
- Buffer passed to existing `AiService.transcribeAudio()` — no changes to AI layer

---

## Out of Scope

- Persisting phone links to Google Sheets (future improvement)
- WhatsApp Business API (Meta) — using Twilio exclusively
- Three-way or more messaging channels
- Read receipts / delivery status tracking

---

## Dependencies

New package: `twilio` (official Twilio Node.js SDK)
