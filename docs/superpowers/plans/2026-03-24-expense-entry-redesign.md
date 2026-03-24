# Expense Entry Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure expense entry so all input methods live under a "Log expense" sub-menu, add a Dictate (voice→AI→confirm) path, and replace four per-field edit buttons with a single "✏️ Edit" button.

**Architecture:** Five sequential tasks from foundation to wiring — enum + i18n first, then AI layer, then handlers, then dispatcher routing last. Each task is independently testable and committable.

**Tech Stack:** NestJS, node-telegram-bot-api, @openrouter/sdk, Jest (unit tests), TypeScript.

**Spec:** `docs/superpowers/specs/2026-03-24-expense-entry-redesign.md`

---

## File Map

| File | Change |
|------|--------|
| `src/conversation/conversation-state.enum.ts` | Add `WAITING_VOICE_EXPENSE` |
| `src/i18n/en.json` | Add all new i18n keys |
| `src/ai/connectors/ai-connector.interface.ts` | Add `extractFromText` to interface |
| `src/ai/connectors/openrouter.connector.ts` | Implement `extractFromText` |
| `src/ai/connectors/openrouter.connector.spec.ts` | Tests for `extractFromText` |
| `src/ai/ai.service.ts` | Add `extractFromText` with fallback |
| `src/telegram/handlers/menu.handler.ts` | Update `showMenu`; add `showExpenseMethodMenu`, `startDictateFlow` |
| `src/telegram/handlers/expense.handler.ts` | Update `showConfirmation`; add `showEditMenu` |
| `src/telegram/telegram.dispatcher.ts` | All routing changes |

---

## Task 1: Foundation — ConversationState enum + i18n keys

**Files:**
- Modify: `src/conversation/conversation-state.enum.ts`
- Modify: `src/i18n/en.json`

No tests for enum/JSON — verified by TypeScript compilation.

- [ ] **Step 1: Add `WAITING_VOICE_EXPENSE` to the enum**

In `src/conversation/conversation-state.enum.ts`, add after `WAITING_RECEIPT`:

```typescript
export enum ConversationState {
  IDLE = 'IDLE',
  WAITING_AMOUNT = 'WAITING_AMOUNT',
  WAITING_PROVIDER = 'WAITING_PROVIDER',
  WAITING_CATEGORY = 'WAITING_CATEGORY',
  WAITING_DESCRIPTION = 'WAITING_DESCRIPTION',
  WAITING_RECEIPT = 'WAITING_RECEIPT',
  WAITING_VOICE_EXPENSE = 'WAITING_VOICE_EXPENSE',
  WAITING_CONFIRMATION = 'WAITING_CONFIRMATION',
  EDITING_FIELD = 'EDITING_FIELD',
}
```

- [ ] **Step 2: Add all new i18n keys to `src/i18n/en.json`**

Add these keys to the `"menu"` section (after `"btn_summary"`):

```json
"expense_method_prompt": "How would you like to log this expense?",
"btn_receipt": "🧾 Upload receipt",
"btn_dictate": "🎙️ Dictate",
"btn_manual": "✏️ Write manually"
```

Add these keys to the `"expense"` section (after `"save_error"`):

```json
"dictate_ask": "🎙️ Send me a voice note describing the expense — I'll fill in the details for you\\.",
"btn_edit": "✏️ Edit",
"edit_menu_prompt": "Which field would you like to edit?",
"btn_edit_amount_short": "💰 Amount",
"btn_edit_provider_short": "🏪 Provider",
"btn_edit_category_short": "🏷️ Category",
"btn_edit_description_short": "📝 Description"
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/conversation/conversation-state.enum.ts src/i18n/en.json
git commit -m "feat: add WAITING_VOICE_EXPENSE state and new i18n keys"
```

---

## Task 2: AI layer — `extractFromText`

**Files:**
- Modify: `src/ai/connectors/ai-connector.interface.ts`
- Modify: `src/ai/connectors/openrouter.connector.ts`
- Modify: `src/ai/connectors/openrouter.connector.spec.ts`
- Modify: `src/ai/ai.service.ts`

Pattern: mirrors `extractFromImage` exactly. The connector sends a text-only message asking the model to return the same 5-field JSON.

- [ ] **Step 1: Write failing test in `openrouter.connector.spec.ts`**

Add a new `describe('extractFromText', ...)` block after the `extractFromImage` describe:

```typescript
describe('extractFromText', () => {
  const validJson = JSON.stringify({
    fecha: '2026-03-24',
    proveedor: 'Ferrería',
    categoria: 'Maintenance',
    descripcion: 'Tornillos y anclajes',
    monto: 35.5,
  });

  it('parses valid JSON response from transcribed text', async () => {
    mockGetText.mockResolvedValueOnce(validJson);
    const result = await connector.extractFromText('compré tornillos en la ferrería por 35.50');
    expect(result.proveedor).toBe('Ferrería');
    expect(result.monto).toBe(35.5);
  });

  it('strips markdown code fences before parsing', async () => {
    mockGetText.mockResolvedValueOnce('```json\n' + validJson + '\n```');
    const result = await connector.extractFromText('texto de prueba');
    expect(result.proveedor).toBe('Ferrería');
  });

  it('tries fallback model when JSON parse fails', async () => {
    mockGetText
      .mockResolvedValueOnce('not valid json')
      .mockResolvedValueOnce(validJson);
    const result = await connector.extractFromText('texto de prueba');
    expect(result.proveedor).toBe('Ferrería');
    expect(mockCallModel).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest openrouter.connector.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `connector.extractFromText is not a function`

- [ ] **Step 3: Add `extractFromText` to the interface**

Replace `src/ai/connectors/ai-connector.interface.ts` with:

```typescript
import { Expense } from '../../shared/interfaces/expense.interface';

export interface IAiConnector {
  readonly name: string;
  extractFromImage(buffer: Buffer): Promise<Partial<Expense>>;
  extractFromText(text: string): Promise<Partial<Expense>>;
  classifyIntent(text: string): Promise<string>;
  transcribeAudio(buffer: Buffer): Promise<string>;
}
```

- [ ] **Step 4: Add `TEXT_PROMPT` constant and `extractFromText` method to `openrouter.connector.ts`**

Add the constant after `AUDIO_PROMPT` (line 26):

```typescript
const TEXT_PROMPT = (text: string) =>
  `Extract expense details from this voice note transcription.
Reply ONLY with a valid JSON object, no markdown, no code blocks:
{
  "fecha": "YYYY-MM-DD",
  "proveedor": "business name",
  "categoria": "one of: Equipment, Maintenance, Utilities, Cleaning, Marketing, Uniforms, Insurance & Health, Administration, Events, Other",
  "descripcion": "brief description",
  "monto": 0.00
}
If a field cannot be determined use empty string or 0 for amount.

Transcription: "${text}"`;
```

Add the `extractFromText` method after `extractFromImage` (around line 75):

```typescript
async extractFromText(text: string): Promise<Partial<Expense>> {
  return this.tryModels(
    ['google/gemini-2.0-flash-001', 'openai/gpt-4o-mini'],
    async (model) => {
      const result = await this.client
        .callModel({ model, input: TEXT_PROMPT(text) })
        .getText();
      return JSON.parse(
        result.replace(/```json|```/g, '').trim(),
      ) as Partial<Expense>;
    },
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest openrouter.connector.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: all tests pass (including the 3 new `extractFromText` ones).

- [ ] **Step 6: Add `extractFromText` to `AiService`**

In `src/ai/ai.service.ts`, add after the `transcribeAudio` method (line 59):

```typescript
async extractFromText(text: string): Promise<Partial<Expense>> {
  for (const connector of this.connectors) {
    try {
      return await connector.extractFromText(text);
    } catch (err) {
      this.logger.warn(
        `[AI] ${connector.name} extractFromText failed: ${(err as Error).message}`,
      );
    }
  }
  // Safe fallback — user fills fields manually on confirmation screen
  return {
    fecha: new Date().toISOString().split('T')[0],
    proveedor: '',
    categoria: 'Other',
    descripcion: '',
    monto: 0,
  };
}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Run all tests**

```bash
npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/ai/connectors/ai-connector.interface.ts src/ai/connectors/openrouter.connector.ts src/ai/connectors/openrouter.connector.spec.ts src/ai/ai.service.ts
git commit -m "feat: add extractFromText to AI layer with connector + service fallback"
```

---

## Task 3: Menu handler — sub-menu + dictate flow

**Files:**
- Modify: `src/telegram/handlers/menu.handler.ts`

Three changes: (1) `showMenu` loses the `cmd_factura` button, (2) new `showExpenseMethodMenu` sends the 4-button sub-menu, (3) new `startDictateFlow` sends the voice prompt and sets state.

- [ ] **Step 1: Update `showMenu` to remove `cmd_factura` button**

In `menu.handler.ts`, replace the entire `inline_keyboard` array in `showMenu` (lines 23–43):

```typescript
inline_keyboard: [
  [
    {
      text: this.i18n.get('menu.btn_log_expense'),
      callback_data: 'cmd_gasto',
    },
  ],
  [
    {
      text: this.i18n.get('menu.btn_recent'),
      callback_data: 'cmd_gastos',
    },
    {
      text: this.i18n.get('menu.btn_summary'),
      callback_data: 'cmd_mes',
    },
  ],
],
```

- [ ] **Step 2: Add `showExpenseMethodMenu` method**

Add after `startReceiptFlow` (after line 63):

```typescript
async showExpenseMethodMenu(chatId: number): Promise<void> {
  await this.bot.sendMessage(
    chatId,
    this.i18n.get('menu.expense_method_prompt'),
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: this.i18n.get('menu.btn_receipt'), callback_data: 'method_receipt' }],
          [{ text: this.i18n.get('menu.btn_dictate'), callback_data: 'method_dictate' }],
          [{ text: this.i18n.get('menu.btn_manual'),  callback_data: 'method_manual'  }],
          [{ text: this.i18n.get('general.back_to_menu'), callback_data: 'back_menu' }],
        ],
      },
    },
  );
}
```

- [ ] **Step 3: Add `startDictateFlow` method**

Add after `showExpenseMethodMenu`:

```typescript
async startDictateFlow(chatId: number): Promise<void> {
  this.conversation.reset(chatId);
  this.conversation.setState(chatId, ConversationState.WAITING_VOICE_EXPENSE);
  await this.bot.sendMessage(chatId, this.i18n.get('expense.dictate_ask'), {
    parse_mode: 'MarkdownV2',
  });
}
```

Make sure `ConversationState` import is already present at the top (it is, line 5). Check the import for `WAITING_VOICE_EXPENSE` — it'll resolve automatically once the enum is updated in Task 1.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/handlers/menu.handler.ts
git commit -m "feat: add showExpenseMethodMenu and startDictateFlow, remove cmd_factura from main menu"
```

---

## Task 4: Expense handler — single Edit button + showEditMenu

**Files:**
- Modify: `src/telegram/handlers/expense.handler.ts`

Two changes: (1) `showConfirmation` loses the two rows of per-field edit buttons and gets a single "✏️ Edit" button, (2) new `showEditMenu` sends a 4-button vertical sub-menu.

- [ ] **Step 1: Update `showConfirmation` keyboard**

In `expense.handler.ts`, replace the `inline_keyboard` in `showConfirmation` (lines 201–231). The new keyboard has two rows instead of three:

```typescript
inline_keyboard: [
  [
    {
      text: this.i18n.get('general.confirm'),
      callback_data: 'confirm_yes',
    },
    {
      text: this.i18n.get('general.cancel'),
      callback_data: 'confirm_no',
    },
  ],
  [
    {
      text: this.i18n.get('expense.btn_edit'),
      callback_data: 'edit_menu',
    },
  ],
],
```

- [ ] **Step 2: Add `showEditMenu` method**

Add after `handleEditField` (after line 255):

```typescript
async showEditMenu(chatId: number): Promise<void> {
  await this.bot.sendMessage(
    chatId,
    this.i18n.get('expense.edit_menu_prompt'),
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: this.i18n.get('expense.btn_edit_amount_short'),      callback_data: 'edit_amount'      }],
          [{ text: this.i18n.get('expense.btn_edit_provider_short'),     callback_data: 'edit_provider'    }],
          [{ text: this.i18n.get('expense.btn_edit_category_short'),     callback_data: 'edit_category'    }],
          [{ text: this.i18n.get('expense.btn_edit_description_short'),  callback_data: 'edit_description' }],
        ],
      },
    },
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/telegram/handlers/expense.handler.ts
git commit -m "feat: replace 4 per-field edit buttons with single edit_menu button; add showEditMenu"
```

---

## Task 5: Dispatcher wiring — all routing changes

**Files:**
- Modify: `src/telegram/telegram.dispatcher.ts`

This task ties everything together. Five distinct changes:
1. Remove `/factura` slash command from `dispatchMessage`
2. Remove `cmd_factura` callback from `dispatchCallback`
3. Route `cmd_gasto` → `menu.showExpenseMethodMenu`
4. Add `method_receipt`, `method_dictate`, `method_manual` callbacks
5. Add `edit_menu` callback BEFORE `startsWith('edit_')` block
6. Add `WAITING_VOICE_EXPENSE` to `EXPENSE_STATES`
7. Update `dispatchVoice` with state branch

- [ ] **Step 1: Update `EXPENSE_STATES` set (line 12)**

Add `ConversationState.WAITING_VOICE_EXPENSE` to the set:

```typescript
const EXPENSE_STATES = new Set([
  ConversationState.WAITING_AMOUNT,
  ConversationState.WAITING_PROVIDER,
  ConversationState.WAITING_CATEGORY,    // text ignored — user must tap keyboard
  ConversationState.WAITING_DESCRIPTION,
  ConversationState.WAITING_RECEIPT,     // text ignored — user must send a photo
  ConversationState.WAITING_VOICE_EXPENSE, // text ignored — user must send a voice note
  ConversationState.WAITING_CONFIRMATION,
  ConversationState.EDITING_FIELD,
]);
```

- [ ] **Step 2: Remove `/factura` slash command from `dispatchMessage`**

Delete line 62–63:
```typescript
if (/^\/(factura|receipt)/.test(text))
  return this.menu.startReceiptFlow(chatId);
```

- [ ] **Step 3: Update `dispatchVoice` method**

Replace lines 69–82 (the entire `dispatchVoice` method) with:

```typescript
/** Called after voice note received */
async dispatchVoice(chatId: number, buffer: Buffer): Promise<void> {
  try {
    const text = await this.ai.transcribeAudio(buffer);
    if (!text) {
      return this.menu.handleUnknown(chatId);
    }
    const ctx = this.conversation.getContext(chatId);
    if (ctx.state === ConversationState.WAITING_VOICE_EXPENSE) {
      const extracted = await this.ai.extractFromText(text);
      if (!extracted.fecha) {
        extracted.fecha = new Date().toISOString().split('T')[0];
      }
      this.conversation.updatePending(chatId, extracted);
      this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
      return this.expense.showConfirmation(chatId);
    }
    return this.dispatchTextInput(chatId, text);
  } catch (err) {
    this.logger.error(`AI dispatch failed for chat ${chatId}`, err);
    this.conversation.reset(chatId);
    await this.bot.sendMessage(chatId, '⚠️ Ocurrió un error. Por favor intenta de nuevo o usa /cancel.');
  }
}
```

- [ ] **Step 4: Update `dispatchCallback` method**

Replace the entire `dispatchCallback` method (lines 84–110) with:

```typescript
async dispatchCallback(query: TelegramBot.CallbackQuery): Promise<void> {
  const chatId = query.message!.chat.id;
  const data = query.data ?? '';

  if (data === 'cmd_gasto')   return this.menu.showExpenseMethodMenu(chatId);
  if (data === 'cmd_gastos')  return this.query.handleRecentExpenses(chatId);
  if (data === 'cmd_mes')     return this.query.handleMonthlySummary(chatId);
  if (data === 'back_menu')   return this.menu.showMenu(chatId);
  if (data === 'confirm_yes') return this.expense.handleConfirmSave(chatId);
  if (data === 'confirm_no')  return this.menu.handleCancel(chatId);

  if (data === 'method_receipt') return this.menu.startReceiptFlow(chatId);
  if (data === 'method_dictate') return this.menu.startDictateFlow(chatId);
  if (data === 'method_manual')  return this.menu.startExpenseFlow(chatId);

  if (data.startsWith('cat_'))
    return this.expense.handleCategorySelected(chatId, data.replace('cat_', ''));
  if (data.startsWith('desc_'))
    return this.expense.handleDescriptionSelected(chatId, data.replace('desc_', ''));

  // IMPORTANT: edit_menu check MUST come before startsWith('edit_') — 'edit_menu'.startsWith('edit_') is true
  if (data === 'edit_menu')
    return this.expense.showEditMenu(chatId);
  if (data.startsWith('edit_'))
    return this.expense.handleEditField(chatId, data.replace('edit_', ''));

  this.logger.warn(`Unknown callback data: ${data}`);
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run all tests**

```bash
npx jest --no-coverage 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/telegram/telegram.dispatcher.ts
git commit -m "feat: wire sub-menu routing, dictate voice flow, edit_menu callback in dispatcher"
```

---

## Verification Checklist

After all 5 tasks are complete, verify the following manually in the bot (or by reading the code):

- [ ] Main menu shows 3 buttons: Log expense (full width), Recent + Summary (side by side)
- [ ] Tapping "Log expense" shows 4-button sub-menu (Receipt / Dictate / Write / Back)
- [ ] Receipt → existing receipt flow unchanged
- [ ] Dictate → bot asks for voice note → voice note → AI extraction → confirmation screen
- [ ] Write manually → existing step-by-step flow unchanged
- [ ] Confirmation screen shows 2 rows: [Confirm | Cancel] and [✏️ Edit]
- [ ] Tapping "✏️ Edit" shows 4-field sub-menu (Amount / Provider / Category / Description)
- [ ] Editing a field then confirming still works
