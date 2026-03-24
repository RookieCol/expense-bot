# Design: Expense Entry Redesign — Sub-menu + Dictate + Single Edit Button

**Date:** 2026-03-24
**Status:** Approved

---

## Overview

Restructure expense entry so that all input methods (receipt photo, voice dictation, manual text) live under a single "Log expense" entry point with a sub-menu. Remove "Upload receipt" from the main menu. Add a "Dictate" voice-first path that always leads to a confirmation screen. Replace four per-field edit buttons on the confirmation screen with a single "✏️ Edit" button and vertical sub-menu.

---

## Feature 1: Navigation Restructure

### Main Menu

Remove the `cmd_factura` (Upload receipt) button. Main menu becomes 3 buttons:

```
[ 💰 Log expense ]
[ 📋 Recent expenses ] [ 📊 Monthly summary ]
```

### Log Expense Sub-menu

Tapping "Log expense" shows a new message with 3 entry methods in a vertical list:

```
[ 🧾 Upload receipt  ]
[ 🎙️ Dictate         ]
[ ✏️ Write manually  ]
[ 🔙 Back            ]
```

Callback data: `method_receipt`, `method_dictate`, `method_manual`, `back_menu`.

### `showExpenseMethodMenu`

New method on `MenuHandler` (alongside existing `startExpenseFlow` and `startReceiptFlow`, which both remain unchanged and are reachable from the sub-menu). Sends a plain-text prompt message with the 3-button vertical keyboard:

```
bot.sendMessage(chatId, i18n.get('menu.expense_method_prompt'), {
  reply_markup: { inline_keyboard: [
    [{ text: i18n.get('menu.btn_receipt'),  callback_data: 'method_receipt'  }],
    [{ text: i18n.get('menu.btn_dictate'),  callback_data: 'method_dictate'  }],
    [{ text: i18n.get('menu.btn_manual'),   callback_data: 'method_manual'   }],
    [{ text: i18n.get('general.back_to_menu'), callback_data: 'back_menu'   }],
  ]}
})
```

**Stale keyboard on Back:** pressing "🔙 Back" calls the existing `back_menu` handler which calls `menu.showMenu`. The sub-menu message remains in chat with live buttons — this is a known UX limitation, accepted as out of scope for this iteration.

### Files changed

- `src/telegram/handlers/menu.handler.ts` — update `showMenu` (remove `cmd_factura` button); add `showExpenseMethodMenu` method
- `src/telegram/telegram.dispatcher.ts` — `cmd_gasto` → `menu.showExpenseMethodMenu`; remove `cmd_factura` button callback and `/factura` slash command from dispatch; add handlers for `method_receipt`, `method_dictate`, `method_manual`. Note: `method_dictate` → `menu.startDictateFlow` depends on Feature 2; stub as a no-op or implement Feature 2 first.
- `src/i18n/en.json` — add keys: `menu.expense_method_prompt`, `menu.btn_receipt`, `menu.btn_dictate`, `menu.btn_manual` (`general.back_to_menu` already exists — no action needed)

---

## Feature 2: Three Entry Flows

### 🧾 Upload Receipt

- `method_receipt` → `menu.startReceiptFlow` (existing) → bot sends "Send me a photo…" → state `WAITING_RECEIPT`
- User sends photo → `ReceiptHandler.handlePhoto` (unchanged) → AI extracts fields → `expenseHandler.showConfirmation`
- **No changes to `ReceiptHandler`**

### 🎙️ Dictate

- `method_dictate` → bot sends "Send me a voice note describing the expense…" → state `WAITING_VOICE_EXPENSE` (new)
- User sends voice note → `telegram.service.ts` detects `msg.voice` → calls `dispatcher.dispatchVoice(chatId, buffer)`
- In `dispatchVoice`: if `ctx.state === WAITING_VOICE_EXPENSE` → transcribe → `ai.extractFromText(text)` → `conversation.updatePending(chatId, extracted)` → `conversation.setState(WAITING_CONFIRMATION)` → `expenseHandler.showConfirmation(chatId)`. If `ctx.state !== WAITING_VOICE_EXPENSE`, fall through to the existing `dispatchTextInput(chatId, text)` call (preserving current NLP classification for voice in other states).
- Always proceeds to confirmation even if fields are empty/zero — user edits before confirming
- `fecha` fallback: if `extracted.fecha` is empty, default to today's ISO date
- **Photo-in-dictate-state:** if the user sends a photo while in `WAITING_VOICE_EXPENSE`, `ReceiptHandler.handlePhoto` will run as normal (photo handler executes before state checks). This is accepted as a benign edge case — the receipt flow will produce a confirmation screen, which is a valid outcome.

### ✏️ Write Manually

- `method_manual` → `menu.startExpenseFlow` (existing, unchanged) → state `WAITING_AMOUNT` → step-by-step flow

### New conversation state

Add `WAITING_VOICE_EXPENSE = 'WAITING_VOICE_EXPENSE'` to `ConversationState` enum.

### New AI method: `extractFromText`

- Added to `IAiConnector` interface, `OpenRouterConnector`, and `AiService`
- Prompt: extract `fecha`, `proveedor`, `categoria`, `descripcion`, `monto` from free-form transcribed text; return JSON
- Return type: `Promise<Partial<Expense>>` — same as `extractFromImage`
- `AiService` fallback when all connectors fail: `{ fecha: today, proveedor: '', categoria: 'Other', descripcion: '', monto: 0 }`
- Models: `['google/gemini-2.0-flash-001', 'openai/gpt-4o-mini']` with `tryModels` fallback (same order as `extractFromImage`)

### Files changed

- `src/conversation/conversation-state.enum.ts` — add `WAITING_VOICE_EXPENSE`
- `src/telegram/handlers/menu.handler.ts` — add `startDictateFlow` method (sends voice prompt, sets `WAITING_VOICE_EXPENSE`)
- `src/telegram/telegram.dispatcher.ts` — update `dispatchVoice` to handle `WAITING_VOICE_EXPENSE` state; add `WAITING_VOICE_EXPENSE` to the `EXPENSE_STATES` set (mirrors `WAITING_RECEIPT` — text messages in this state are silently ignored, since the user is expected to send a voice note)
- `src/ai/connectors/ai-connector.interface.ts` — add `extractFromText`
- `src/ai/connectors/openrouter.connector.ts` — implement `extractFromText`
- `src/ai/ai.service.ts` — add `extractFromText` with fallback
- `src/i18n/en.json` — add key: `expense.dictate_ask`

---

## Feature 3: Single Edit Button on Confirmation

### Problem

Confirmation screen currently shows 4 per-field edit buttons (Edit amount, Edit provider, Edit category, Edit description). This clutters the UI and is especially problematic now that Receipt and Dictate can produce confirmations with multiple empty fields.

### Design

**`showConfirmation` change:**

Replace the two rows of per-field buttons with a single row:
```
[ ✅ Confirm ] [ ❌ Cancel ]
[      ✏️ Edit            ]
```
Callback: `edit_menu`.

**New `showEditMenu(chatId)` method on `ExpenseHandler`:**

Sends a new message with a vertical inline keyboard:
```
[ 💰 Amount      ]
[ 🏪 Provider    ]
[ 🏷️ Category    ]
[ 📝 Description ]
```
Each button uses existing `edit_amount`, `edit_provider`, `edit_category`, `edit_description` callback values. Edit field flow (prompts, `EDITING_FIELD` state) is unchanged.

**Stale edit-menu keyboard:** after the user picks a field, edits it, and `showConfirmation` is called again, the original `showEditMenu` message stays in chat with four clickable buttons. Tapping a stale button will re-trigger the same edit flow — this is functionally correct but visually noisy. Accepted as a known UX limitation, out of scope for this iteration (same policy as the stale sub-menu on Back).

**`dispatchCallback` ordering constraint:**
The `edit_menu` equality check MUST appear BEFORE the `data.startsWith('edit_')` block — `'edit_menu'.startsWith('edit_')` is true and would be swallowed by the prefix handler if placed after it.

### Files changed

- `src/telegram/handlers/expense.handler.ts` — update `showConfirmation`; add `showEditMenu`
- `src/telegram/telegram.dispatcher.ts` — add `edit_menu` handler before `startsWith('edit_')` block
- `src/i18n/en.json` — add keys: `expense.btn_edit`, `expense.edit_menu_prompt`, `expense.btn_edit_amount_short`, `expense.btn_edit_provider_short`, `expense.btn_edit_category_short`, `expense.btn_edit_description_short`

---

## Architecture Impact

All changes are additive. The existing step-by-step manual flow is untouched. `ReceiptHandler` is untouched. The new `WAITING_VOICE_EXPENSE` state is isolated — it only affects `dispatchVoice` routing and does not interfere with other states. The `extractFromText` AI method follows the exact same pattern as `extractFromImage`.

---

## Out of Scope

- Chat mode / free-form LLM conversation
- Conversation history / multi-turn context
- Voice notes outside the explicit Dictate flow (sending voice in IDLE or mid-flow)
- Persisting state to a database
