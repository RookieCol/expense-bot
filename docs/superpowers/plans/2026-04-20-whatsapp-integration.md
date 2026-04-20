# WhatsApp Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WhatsApp as a parallel contact channel alongside Telegram using a `MessagingPort` abstraction, so all handlers are platform-agnostic and new channels can be added with minimal changes.

**Architecture:** Extract a `MessagingPort` interface that all handlers depend on instead of `TelegramBot` directly. `TelegramAdapter` wraps the existing bot; `WhatsAppAdapter` wraps Twilio. Both modules provide their own adapter instance bound to `MESSAGING_PORT`, so handlers are instantiated per-module with the right transport. `ConversationService` is migrated to string-keyed IDs to support both numeric Telegram IDs and WhatsApp phone numbers.

**Tech Stack:** NestJS 11, `twilio` SDK, `node-telegram-bot-api`, Jest/ts-jest for unit tests.

---

## File Map

**New files:**
- `src/shared/messaging/messaging-port.interface.ts` — `MessagingPort` interface + `MESSAGING_PORT` token + `MenuSection` / `SentMessage` types
- `src/telegram/telegram.adapter.ts` — `TelegramAdapter` implementing `MessagingPort`
- `src/telegram/telegram.adapter.spec.ts` — unit tests for adapter
- `src/whatsapp/whatsapp.module.ts` — NestJS module wiring
- `src/whatsapp/whatsapp.adapter.ts` — `WhatsAppAdapter` implementing `MessagingPort`
- `src/whatsapp/whatsapp.adapter.spec.ts` — unit tests
- `src/whatsapp/whatsapp.dispatcher.ts` — routes Twilio webhook payloads to handlers
- `src/whatsapp/whatsapp.dispatcher.spec.ts` — unit tests
- `src/whatsapp/whatsapp-webhook.controller.ts` — `POST /whatsapp/webhook`
- `src/whatsapp/phone-link.service.ts` — in-memory Telegram↔phone map
- `src/whatsapp/phone-link.service.spec.ts` — unit tests

**Modified files:**
- `src/conversation/conversation-context.interface.ts` — message IDs `number` → `string`
- `src/conversation/conversation.service.ts` — `Map<number>` → `Map<string>`
- `src/telegram/step-messenger.service.ts` — inject `MessagingPort` instead of `BOT`
- `src/telegram/handlers/menu.handler.ts` — inject `MessagingPort`, `chatId: string`
- `src/telegram/handlers/expense.handler.ts` — inject `MessagingPort`, `chatId: string`
- `src/telegram/handlers/receipt.handler.ts` — inject `MessagingPort`, `chatId: string`
- `src/telegram/handlers/query.handler.ts` — inject `MessagingPort`, `chatId: string`
- `src/telegram/telegram.dispatcher.ts` — inject `MessagingPort` + `PhoneLinkService`, `chatId: number → string`, add `/vincular`
- `src/telegram/telegram.module.ts` — add `TelegramAdapter`, `PhoneLinkService`, re-wire `MESSAGING_PORT`
- `src/app.module.ts` — add `WhatsAppModule`
- `src/config/config.schema.ts` — add Twilio env vars
- `.env.example` — add Twilio vars

---

## Task 1: Install twilio package

**Files:**
- Modify: `package.json` (via pnpm)

- [ ] **Step 1: Install twilio**

```bash
cd /path/to/expense-bot && pnpm add twilio
```

Expected: `twilio` appears in `dependencies` in `package.json`. The `twilio` package ships its own TypeScript types so no `@types/twilio` is needed.

- [ ] **Step 2: Verify TypeScript can find types**

```bash
pnpm exec tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `twilio` module resolution (there may be existing errors unrelated to this task).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add twilio dependency"
```

---

## Task 2: Create MessagingPort interface

**Files:**
- Create: `src/shared/messaging/messaging-port.interface.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/shared/messaging/messaging-port.interface.ts

export const MESSAGING_PORT = 'MESSAGING_PORT';

export interface SentMessage {
  messageId: string;
}

export interface MenuOption {
  id: string;
  label: string;
  description?: string;
}

export interface MenuSection {
  title: string;
  options: MenuOption[];
}

export interface MessagingPort {
  sendText(chatId: string, text: string, opts?: { parseMode?: 'MarkdownV2' | 'HTML' }): Promise<SentMessage>;
  editText(chatId: string, messageId: string, text: string, opts?: { parseMode?: 'MarkdownV2' | 'HTML' }): Promise<SentMessage>;
  deleteMessage(chatId: string, messageId: string): Promise<void>;
  sendMenu(chatId: string, text: string, sections: MenuSection[]): Promise<SentMessage>;
  sendPhoto(chatId: string, url: string, caption?: string): Promise<SentMessage>;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm exec tsc --noEmit 2>&1 | grep messaging-port
```

Expected: no output (no errors in this file).

- [ ] **Step 3: Commit**

```bash
git add src/shared/messaging/messaging-port.interface.ts
git commit -m "feat: add MessagingPort interface and MESSAGING_PORT token"
```

---

## Task 3: Migrate ConversationContext + ConversationService to string IDs

The `ConversationService` currently uses `number` keys (Telegram chat IDs). Migrating to `string` lets both Telegram (numeric IDs converted to string) and WhatsApp (phone numbers) share the same service.

**Files:**
- Modify: `src/conversation/conversation-context.interface.ts`
- Modify: `src/conversation/conversation.service.ts`

- [ ] **Step 1: Update ConversationContext — change all message ID fields from `number` to `string`**

Replace the entire content of `src/conversation/conversation-context.interface.ts` with:

```typescript
import { ConversationState } from './conversation-state.enum';
import { Expense } from '../shared/interfaces/expense.interface';

export interface ConversationContext {
  state: ConversationState;
  pendingExpense: Partial<Expense>;
  lastImageBuffer?: Buffer;
  editingField?: string;
  userName?: string;
  lastBotMessageId?: string;
  editStepMessageId?: string;
  manualStepIds: string[];
  userMessageIds: string[];
}
```

- [ ] **Step 2: Update ConversationService — change Map key and all `chatId` params from `number` to `string`**

Replace the entire content of `src/conversation/conversation.service.ts` with:

```typescript
import { Injectable } from '@nestjs/common';
import { ConversationState } from './conversation-state.enum';
import { ConversationContext } from './conversation-context.interface';
import { Expense } from '../shared/interfaces/expense.interface';

@Injectable()
export class ConversationService {
  private contexts = new Map<string, ConversationContext>();

  getContext(chatId: string): ConversationContext {
    if (!this.contexts.has(chatId)) {
      this.contexts.set(chatId, {
        state: ConversationState.IDLE,
        pendingExpense: {},
        manualStepIds: [],
        userMessageIds: [],
      });
    }
    return this.contexts.get(chatId)!;
  }

  setState(chatId: string, state: ConversationState): void {
    this.getContext(chatId).state = state;
  }

  updatePending(chatId: string, data: Partial<Expense>): void {
    const ctx = this.getContext(chatId);
    ctx.pendingExpense = { ...ctx.pendingExpense, ...data };
  }

  setImageBuffer(chatId: string, buffer: Buffer): void {
    this.getContext(chatId).lastImageBuffer = buffer;
  }

  setEditingField(chatId: string, field: string): void {
    this.getContext(chatId).editingField = field;
  }

  setUserName(chatId: string, userName: string): void {
    this.getContext(chatId).userName = userName;
  }

  setLastBotMessageId(chatId: string, messageId: string): void {
    this.getContext(chatId).lastBotMessageId = messageId;
  }

  setEditStepMessageId(chatId: string, messageId: string | undefined): void {
    this.getContext(chatId).editStepMessageId = messageId;
  }

  addManualStepId(chatId: string, messageId: string): void {
    this.getContext(chatId).manualStepIds.push(messageId);
  }

  addUserMessageId(chatId: string, messageId: string): void {
    this.getContext(chatId).userMessageIds.push(messageId);
  }

  reset(chatId: string): void {
    const { userName, lastBotMessageId } = this.getContext(chatId);
    this.contexts.set(chatId, {
      state: ConversationState.IDLE,
      pendingExpense: {},
      manualStepIds: [],
      userMessageIds: [],
      userName,
      lastBotMessageId,
    });
  }
}
```

- [ ] **Step 3: Check TypeScript errors — there will be many since handlers still use `number`**

```bash
pnpm exec tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: many errors (handlers haven't been updated yet). This is normal at this stage.

- [ ] **Step 4: Commit**

```bash
git add src/conversation/conversation-context.interface.ts src/conversation/conversation.service.ts
git commit -m "refactor: migrate ConversationService to string chatIds"
```

---

## Task 4: Create TelegramAdapter

The adapter wraps `node-telegram-bot-api`, converting the `MessagingPort` calls to Telegram Bot API calls. It converts string chatIds/messageIds back to numbers at the Telegram boundary.

**Files:**
- Create: `src/telegram/telegram.adapter.ts`
- Create: `src/telegram/telegram.adapter.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/telegram/telegram.adapter.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramAdapter } from './telegram.adapter';
import { BOT } from './bot.provider';

const mockSendMessage = jest.fn();
const mockDeleteMessage = jest.fn();
const mockEditMessageText = jest.fn();
const mockSendPhoto = jest.fn();

const mockBot: Partial<TelegramBot> = {
  sendMessage: mockSendMessage,
  deleteMessage: mockDeleteMessage,
  editMessageText: mockEditMessageText,
  sendPhoto: mockSendPhoto,
};

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramAdapter,
        { provide: BOT, useValue: mockBot },
      ],
    }).compile();
    adapter = module.get(TelegramAdapter);
    jest.clearAllMocks();
  });

  it('sendText calls bot.sendMessage with numeric chatId', async () => {
    mockSendMessage.mockResolvedValue({ message_id: 42 });
    const result = await adapter.sendText('123', 'hello');
    expect(mockSendMessage).toHaveBeenCalledWith(123, 'hello', {});
    expect(result.messageId).toBe('42');
  });

  it('sendText passes parseMode option', async () => {
    mockSendMessage.mockResolvedValue({ message_id: 1 });
    await adapter.sendText('1', 'text', { parseMode: 'MarkdownV2' });
    expect(mockSendMessage).toHaveBeenCalledWith(1, 'text', { parse_mode: 'MarkdownV2' });
  });

  it('deleteMessage calls bot.deleteMessage and swallows errors', async () => {
    mockDeleteMessage.mockRejectedValue(new Error('not found'));
    await expect(adapter.deleteMessage('1', '99')).resolves.toBeUndefined();
    expect(mockDeleteMessage).toHaveBeenCalledWith(1, 99);
  });

  it('sendMenu builds inline keyboard from sections', async () => {
    mockSendMessage.mockResolvedValue({ message_id: 5 });
    await adapter.sendMenu('10', 'Choose:', [
      { title: 'Group', options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ]},
    ]);
    const call = mockSendMessage.mock.calls[0];
    const opts = call[2] as TelegramBot.SendMessageOptions;
    const keyboard = (opts.reply_markup as TelegramBot.InlineKeyboardMarkup).inline_keyboard;
    // 3 options, 2 per row → 2 rows
    expect(keyboard.length).toBe(2);
    expect(keyboard[0][0].callback_data).toBe('a');
    expect(keyboard[0][1].callback_data).toBe('b');
    expect(keyboard[1][0].callback_data).toBe('c');
  });

  it('editText calls bot.editMessageText with numeric ids', async () => {
    mockEditMessageText.mockResolvedValue({});
    await adapter.editText('7', '3', 'new text');
    expect(mockEditMessageText).toHaveBeenCalledWith('new text', {
      chat_id: 7,
      message_id: 3,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- --testPathPattern=telegram.adapter.spec
```

Expected: FAIL — `TelegramAdapter` doesn't exist yet.

- [ ] **Step 3: Implement TelegramAdapter**

Create `src/telegram/telegram.adapter.ts`:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { BOT } from './bot.provider';
import {
  MessagingPort,
  MenuSection,
  SentMessage,
} from '../shared/messaging/messaging-port.interface';

@Injectable()
export class TelegramAdapter implements MessagingPort {
  constructor(@Inject(BOT) private readonly bot: TelegramBot) {}

  async sendText(
    chatId: string,
    text: string,
    opts?: { parseMode?: 'MarkdownV2' | 'HTML' },
  ): Promise<SentMessage> {
    const sendOpts: TelegramBot.SendMessageOptions = {};
    if (opts?.parseMode) sendOpts.parse_mode = opts.parseMode;
    const msg = await this.bot.sendMessage(Number(chatId), text, sendOpts);
    return { messageId: String(msg.message_id) };
  }

  async editText(
    chatId: string,
    messageId: string,
    text: string,
    opts?: { parseMode?: 'MarkdownV2' | 'HTML' },
  ): Promise<SentMessage> {
    const editOpts: TelegramBot.EditMessageTextOptions = {
      chat_id: Number(chatId),
      message_id: Number(messageId),
    };
    if (opts?.parseMode) editOpts.parse_mode = opts.parseMode;
    await this.bot.editMessageText(text, editOpts);
    return { messageId };
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    await this.bot.deleteMessage(Number(chatId), Number(messageId)).catch(() => {});
  }

  async sendMenu(chatId: string, text: string, sections: MenuSection[]): Promise<SentMessage> {
    const allOptions = sections.flatMap((s) => s.options);
    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    for (let i = 0; i < allOptions.length; i += 2) {
      keyboard.push(
        allOptions.slice(i, i + 2).map((o) => ({
          text: o.label,
          callback_data: o.id,
        })),
      );
    }
    const msg = await this.bot.sendMessage(Number(chatId), text, {
      reply_markup: { inline_keyboard: keyboard },
    });
    return { messageId: String(msg.message_id) };
  }

  async sendPhoto(chatId: string, url: string, caption?: string): Promise<SentMessage> {
    const msg = await this.bot.sendPhoto(Number(chatId), url, caption ? { caption } : {});
    return { messageId: String(msg.message_id) };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- --testPathPattern=telegram.adapter.spec
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/telegram.adapter.ts src/telegram/telegram.adapter.spec.ts
git commit -m "feat: add TelegramAdapter implementing MessagingPort"
```

---

## Task 5: Refactor StepMessenger to use MessagingPort

`StepMessenger` currently uses `TelegramBot` directly. After this task it uses `MessagingPort`, so it works for both Telegram and WhatsApp.

**Files:**
- Modify: `src/telegram/step-messenger.service.ts`

- [ ] **Step 1: Replace the file content**

```typescript
import { Injectable, Inject } from '@nestjs/common';
import {
  MessagingPort,
  MESSAGING_PORT,
  SentMessage,
} from '../shared/messaging/messaging-port.interface';
import { ConversationService } from '../conversation/conversation.service';

@Injectable()
export class StepMessenger {
  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
  ) {}

  async send(
    chatId: string,
    text: string,
    opts?: { parseMode?: 'MarkdownV2' | 'HTML' },
  ): Promise<SentMessage> {
    const ctx = this.conversation.getContext(chatId);
    const toDelete = [
      ctx.lastBotMessageId,
      ctx.editStepMessageId,
      ...(ctx.manualStepIds ?? []),
      ...(ctx.userMessageIds ?? []),
    ].filter((id): id is string => !!id);
    this.conversation.setEditStepMessageId(chatId, undefined);
    const msg = await this.messaging.sendText(chatId, text, opts);
    await Promise.all(toDelete.map((id) => this.messaging.deleteMessage(chatId, id)));
    this.conversation.setLastBotMessageId(chatId, msg.messageId);
    return msg;
  }
}
```

- [ ] **Step 2: Check TypeScript errors in step-messenger only**

```bash
pnpm exec tsc --noEmit 2>&1 | grep step-messenger
```

Expected: no errors in `step-messenger.service.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/telegram/step-messenger.service.ts
git commit -m "refactor: StepMessenger uses MessagingPort instead of TelegramBot"
```

---

## Task 6: Refactor MenuHandler to use MessagingPort

**Files:**
- Modify: `src/telegram/handlers/menu.handler.ts`

Note: `showMenu` and `handleCancel` currently pass Telegram-specific inline keyboards. After this refactor they use `sendMenu` with `MenuSection[]`. The `startExpenseFlow`, `startReceiptFlow`, `startDictateFlow`, `handleUnknown` use `sendText`.

- [ ] **Step 1: Replace the file content**

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  MessagingPort,
  MESSAGING_PORT,
} from '../../shared/messaging/messaging-port.interface';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { I18nService } from '../../i18n/i18n.service';
import { StepMessenger } from '../step-messenger.service';

@Injectable()
export class MenuHandler {
  private readonly logger = new Logger(MenuHandler.name);

  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
    private readonly i18n: I18nService,
    private readonly step: StepMessenger,
  ) {}

  async showMenu(chatId: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const toDelete = [
      ctx.lastBotMessageId,
      ctx.editStepMessageId,
      ...(ctx.manualStepIds ?? []),
      ...(ctx.userMessageIds ?? []),
    ].filter((id): id is string => !!id);
    this.conversation.reset(chatId);
    const msg = await this.messaging.sendMenu(
      chatId,
      this.i18n.get('menu.welcome'),
      [
        { title: '', options: [
          { id: 'cmd_gasto',  label: this.i18n.get('menu.btn_log_expense') },
          { id: 'cmd_gastos', label: this.i18n.get('menu.btn_recent') },
          { id: 'cmd_mes',    label: this.i18n.get('menu.btn_summary') },
        ]},
      ],
    );
    await Promise.all(toDelete.map((id) => this.messaging.deleteMessage(chatId, id)));
    this.conversation.setLastBotMessageId(chatId, msg.messageId);
  }

  async startExpenseFlow(chatId: string): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_AMOUNT);
    const msg = await this.messaging.sendText(
      chatId,
      this.i18n.get('expense.ask_amount'),
      { parseMode: 'MarkdownV2' },
    );
    this.conversation.addManualStepId(chatId, msg.messageId);
  }

  async startReceiptFlow(chatId: string): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_RECEIPT);
    await this.step.send(chatId, this.i18n.get('receipt.ask'), { parseMode: 'MarkdownV2' });
  }

  async showExpenseMethodMenu(chatId: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const toDelete = [
      ctx.lastBotMessageId,
      ctx.editStepMessageId,
      ...(ctx.manualStepIds ?? []),
      ...(ctx.userMessageIds ?? []),
    ].filter((id): id is string => !!id);
    this.conversation.setEditStepMessageId(chatId, undefined);
    const msg = await this.messaging.sendMenu(
      chatId,
      this.i18n.get('menu.expense_method_prompt'),
      [
        { title: '', options: [
          { id: 'method_receipt', label: this.i18n.get('menu.btn_receipt') },
          { id: 'method_dictate', label: this.i18n.get('menu.btn_dictate') },
          { id: 'method_manual',  label: this.i18n.get('menu.btn_manual')  },
          { id: 'back_menu',      label: this.i18n.get('general.back_to_menu') },
        ]},
      ],
    );
    await Promise.all(toDelete.map((id) => this.messaging.deleteMessage(chatId, id)));
    this.conversation.setLastBotMessageId(chatId, msg.messageId);
  }

  async startDictateFlow(chatId: string): Promise<void> {
    this.conversation.reset(chatId);
    this.conversation.setState(chatId, ConversationState.WAITING_VOICE_EXPENSE);
    await this.step.send(chatId, this.i18n.get('expense.dictate_ask'), { parseMode: 'MarkdownV2' });
  }

  async handleCancel(chatId: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const toDelete = [
      ctx.lastBotMessageId,
      ctx.editStepMessageId,
      ...(ctx.manualStepIds ?? []),
      ...(ctx.userMessageIds ?? []),
    ].filter((id): id is string => !!id);
    this.conversation.reset(chatId);
    const msg = await this.messaging.sendText(
      chatId,
      this.i18n.get('general.cancelled'),
      { parseMode: 'MarkdownV2' },
    );
    await Promise.all(toDelete.map((id) => this.messaging.deleteMessage(chatId, id)));
    this.conversation.setLastBotMessageId(chatId, msg.messageId);
  }

  async handleUnknown(chatId: string): Promise<void> {
    await this.messaging.sendText(chatId, this.i18n.get('nlp.unknown'), { parseMode: 'MarkdownV2' });
  }

  async showVincularPrompt(chatId: string): Promise<void> {
    await this.messaging.sendText(
      chatId,
      '📱 Comparte tu número de teléfono para vincular tu cuenta de WhatsApp\\.\n\nUsa el botón "Compartir contacto" debajo\\.',
      { parseMode: 'MarkdownV2' },
    );
  }
}
```

Note: `showExpenseMethodMenu` was sending `step.send` first (unnecessary duplicate) — that extra call is removed. The method now calls `sendMenu` directly, tracking and deleting old messages.

- [ ] **Step 2: Check TypeScript errors in menu.handler only**

```bash
pnpm exec tsc --noEmit 2>&1 | grep menu.handler
```

Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add src/telegram/handlers/menu.handler.ts
git commit -m "refactor: MenuHandler uses MessagingPort, chatId: string"
```

---

## Task 7: Refactor ExpenseHandler to use MessagingPort

**Files:**
- Modify: `src/telegram/handlers/expense.handler.ts`

The key changes: replace `@Inject(BOT)` with `@Inject(MESSAGING_PORT)`, change `chatId: number` to `chatId: string`, replace all `bot.sendMessage`/`bot.deleteMessage` calls with `messaging.*` equivalents. Inline keyboard sends become `sendMenu`.

- [ ] **Step 1: Replace the file content**

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  MessagingPort,
  MESSAGING_PORT,
} from '../../shared/messaging/messaging-port.interface';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { SheetsService } from '../../google/sheets.service';
import { DriveService } from '../../google/drive.service';
import { I18nService } from '../../i18n/i18n.service';
import { Expense } from '../../shared/interfaces/expense.interface';
import { CATEGORIES, CATEGORY_LABEL } from '../../shared/categories';
import { MenuHandler } from './menu.handler';
import { StepMessenger } from '../step-messenger.service';

@Injectable()
export class ExpenseHandler {
  private readonly logger = new Logger(ExpenseHandler.name);

  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
    private readonly sheets: SheetsService,
    private readonly drive: DriveService,
    private readonly i18n: I18nService,
    private readonly menuHandler: MenuHandler,
    private readonly step: StepMessenger,
  ) {}

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  }

  private formatAmount(amount: number): string {
    const [intPart, decPart] = amount.toFixed(2).split('.');
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${intFormatted},${decPart}`;
  }

  async handleText(chatId: string, text: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    switch (ctx.state) {
      case ConversationState.WAITING_AMOUNT:
        return this.handleAmountInput(chatId, text);
      case ConversationState.WAITING_PROVIDER:
        return this.handleProviderInput(chatId, text);
      case ConversationState.WAITING_DESCRIPTION:
        return this.handleDescriptionInput(chatId, text);
      case ConversationState.EDITING_FIELD:
        return this.handleEditInput(chatId, text, ctx.editingField ?? '');
      default:
        return;
    }
  }

  private async handleAmountInput(chatId: string, text: string): Promise<void> {
    const monto = parseFloat(text.replace(',', '.'));
    if (isNaN(monto) || monto <= 0) {
      await this.messaging.sendText(
        chatId,
        this.i18n.get('expense.amount_invalid'),
        { parseMode: 'MarkdownV2' },
      );
      return;
    }
    this.conversation.updatePending(chatId, { monto });
    this.conversation.setState(chatId, ConversationState.WAITING_PROVIDER);
    const msg = await this.messaging.sendText(
      chatId,
      this.i18n.get('expense.amount_confirmed', { amount: this.escape(this.formatAmount(monto)) }),
      { parseMode: 'MarkdownV2' },
    );
    this.conversation.addManualStepId(chatId, msg.messageId);
  }

  private async handleProviderInput(chatId: string, text: string): Promise<void> {
    this.conversation.updatePending(chatId, { proveedor: text });
    this.conversation.setState(chatId, ConversationState.WAITING_CATEGORY);
    await this.askCategory(chatId);
  }

  async askCategory(chatId: string, deleteStep = true): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const options = CATEGORIES.map((c) => ({ id: `cat_${c.value}`, label: c.label }));
    options.push({ id: 'confirm_no', label: this.i18n.get('general.cancel') });
    const key = ctx.pendingExpense?.proveedor
      ? 'expense.ask_category'
      : 'expense.ask_category_generic';
    const text = this.i18n.get(key, {
      provider: this.escape(ctx.pendingExpense?.proveedor || ''),
    });
    const msg = await this.messaging.sendMenu(chatId, text, [{ title: '', options }]);
    if (deleteStep) {
      this.conversation.addManualStepId(chatId, msg.messageId);
    } else {
      this.conversation.setEditStepMessageId(chatId, msg.messageId);
    }
  }

  async handleCategorySelected(chatId: string, category: string): Promise<void> {
    this.conversation.updatePending(chatId, { categoria: category });
    const ctx = this.conversation.getContext(chatId);
    if (ctx.pendingExpense.descripcion) {
      this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
      await this.showConfirmation(chatId);
    } else {
      await this.askDescription(chatId);
    }
  }

  private async askDescription(chatId: string): Promise<void> {
    this.conversation.setState(chatId, ConversationState.WAITING_DESCRIPTION);
    const msg = await this.messaging.sendText(
      chatId,
      this.i18n.get('expense.ask_description'),
      { parseMode: 'MarkdownV2' },
    );
    this.conversation.addManualStepId(chatId, msg.messageId);
  }

  async handleDescriptionSelected(chatId: string, desc: string): Promise<void> {
    if (desc === 'custom') {
      const msg = await this.messaging.sendText(
        chatId,
        this.i18n.get('expense.ask_description_write'),
        { parseMode: 'MarkdownV2' },
      );
      this.conversation.addManualStepId(chatId, msg.messageId);
      return;
    }
    await this.handleDescriptionInput(chatId, desc);
  }

  private async handleDescriptionInput(chatId: string, text: string): Promise<void> {
    this.conversation.updatePending(chatId, { descripcion: text });
    this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
    await this.showConfirmation(chatId);
  }

  async showConfirmation(chatId: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    const toDelete = [...ctx.manualStepIds, ...ctx.userMessageIds];
    if (toDelete.length > 0) {
      await Promise.all(toDelete.map((id) => this.messaging.deleteMessage(chatId, id)));
      ctx.manualStepIds = [];
      ctx.userMessageIds = [];
    }
    const e = ctx.pendingExpense;
    const lines = [
      this.i18n.get('expense.confirmation_title'),
      '',
      `${this.i18n.get('expense.confirmation_date')} ${this.escape(e.fecha || '')}`,
      `${this.i18n.get('expense.confirmation_provider')} ${this.escape(e.proveedor || '')}`,
      `${this.i18n.get('expense.confirmation_category')} ${this.escape(CATEGORY_LABEL[e.categoria ?? ''] ?? e.categoria ?? '')}`,
      `${this.i18n.get('expense.confirmation_description')} ${this.escape(e.descripcion || '')}`,
      `${this.i18n.get('expense.confirmation_amount')} \\$${this.escape(this.formatAmount(e.monto ?? 0))}`,
      '',
      this.i18n.get('expense.confirmation_question'),
    ];
    await this.step.send(chatId, lines.join('\n'), { parseMode: 'MarkdownV2' });
    // Send confirmation buttons as a separate menu (step.send only sends text)
    const confirmMsg = await this.messaging.sendMenu(chatId, '↓', [
      { title: '', options: [
        { id: 'confirm_yes', label: this.i18n.get('general.confirm') },
        { id: 'confirm_no',  label: this.i18n.get('general.cancel')  },
        { id: 'edit_menu',   label: this.i18n.get('expense.btn_edit') },
      ]},
    ]);
    this.conversation.setLastBotMessageId(chatId, confirmMsg.messageId);
  }

  async handleEditField(chatId: string, field: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    if (ctx.editStepMessageId) {
      await this.messaging.deleteMessage(chatId, ctx.editStepMessageId);
      this.conversation.setEditStepMessageId(chatId, undefined);
    }
    if (field === 'category') {
      this.conversation.setState(chatId, ConversationState.WAITING_CATEGORY);
      return this.askCategory(chatId, false);
    }
    this.conversation.setEditingField(chatId, field);
    this.conversation.setState(chatId, ConversationState.EDITING_FIELD);
    const msgMap: Record<string, string> = {
      amount:      'expense.edit_ask_amount',
      provider:    'expense.edit_ask_provider',
      description: 'expense.edit_ask_description',
    };
    const msgKey = msgMap[field];
    if (msgKey) {
      const msg = await this.messaging.sendText(chatId, this.i18n.get(msgKey), { parseMode: 'MarkdownV2' });
      this.conversation.setEditStepMessageId(chatId, msg.messageId);
    }
  }

  async showEditMenu(chatId: string): Promise<void> {
    const msg = await this.messaging.sendMenu(chatId, this.i18n.get('expense.edit_menu_prompt'), [
      { title: '', options: [
        { id: 'edit_amount',      label: this.i18n.get('expense.btn_edit_amount_short')      },
        { id: 'edit_provider',    label: this.i18n.get('expense.btn_edit_provider_short')    },
        { id: 'edit_category',    label: this.i18n.get('expense.btn_edit_category_short')    },
        { id: 'edit_description', label: this.i18n.get('expense.btn_edit_description_short') },
      ]},
    ]);
    this.conversation.setEditStepMessageId(chatId, msg.messageId);
  }

  private async handleEditInput(chatId: string, text: string, field: string): Promise<void> {
    switch (field) {
      case 'amount': {
        const monto = parseFloat(text.replace(',', '.'));
        if (isNaN(monto) || monto <= 0) {
          await this.messaging.sendText(
            chatId,
            this.i18n.get('expense.amount_invalid_edit'),
            { parseMode: 'MarkdownV2' },
          );
          return;
        }
        this.conversation.updatePending(chatId, { monto });
        break;
      }
      case 'provider':
        this.conversation.updatePending(chatId, { proveedor: text });
        break;
      case 'description':
        this.conversation.updatePending(chatId, { descripcion: text });
        break;
    }
    this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
    await this.showConfirmation(chatId);
  }

  async handleConfirmSave(chatId: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    if (ctx.state !== ConversationState.WAITING_CONFIRMATION) return;
    const confirmationId = ctx.lastBotMessageId;
    this.conversation.reset(chatId);
    if (confirmationId) {
      await this.messaging.deleteMessage(chatId, confirmationId);
    }
    const e = { ...ctx.pendingExpense, registradoPor: ctx.userName } as Expense;
    const savingMsg = await this.messaging.sendText(
      chatId,
      this.i18n.get('expense.saving'),
      { parseMode: 'MarkdownV2' },
    );
    try {
      let receiptLink = '';
      if (ctx.lastImageBuffer) {
        try {
          const filename = `receipt_${Date.now()}.jpg`;
          receiptLink = await this.drive.uploadImage(ctx.lastImageBuffer, filename);
          e.facturaLink = receiptLink;
        } catch (driveErr) {
          this.logger.warn(
            `Drive upload failed, saving without receipt: ${(driveErr as Error).message}`,
          );
        }
      }
      if (!e.fecha) e.fecha = new Date().toISOString().split('T')[0];
      await this.sheets.appendExpense(e);
      await this.messaging.deleteMessage(chatId, savingMsg.messageId);
      const savedMsg = await this.messaging.sendText(chatId, this.i18n.get('expense.saved'));
      this.conversation.reset(chatId);
      this.conversation.setLastBotMessageId(chatId, savedMsg.messageId);
    } catch (err) {
      this.logger.error(`Save error: ${(err as Error).message}`, (err as Error).stack);
      await this.messaging.sendText(chatId, this.i18n.get('expense.save_error'), { parseMode: 'MarkdownV2' });
    }
  }
}
```

- [ ] **Step 2: Check TypeScript errors in expense.handler only**

```bash
pnpm exec tsc --noEmit 2>&1 | grep expense.handler
```

Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add src/telegram/handlers/expense.handler.ts
git commit -m "refactor: ExpenseHandler uses MessagingPort, chatId: string"
```

---

## Task 8: Refactor ReceiptHandler to use MessagingPort

**Files:**
- Modify: `src/telegram/handlers/receipt.handler.ts`

`handlePhoto` takes a `TelegramBot.Message` — this is Telegram-specific. After refactoring, it takes pre-downloaded `buffer` and `chatId: string`, and the Telegram-specific download logic moves to `TelegramService`. A new `handlePhotoBuffer` method is the platform-agnostic entry point used by both dispatchers.

- [ ] **Step 1: Replace the file content**

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  MessagingPort,
  MESSAGING_PORT,
} from '../../shared/messaging/messaging-port.interface';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { AiService } from '../../ai/ai.service';
import { I18nService } from '../../i18n/i18n.service';
import { ExpenseHandler } from './expense.handler';

@Injectable()
export class ReceiptHandler {
  private readonly logger = new Logger(ReceiptHandler.name);

  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
    private readonly ai: AiService,
    private readonly i18n: I18nService,
    private readonly expenseHandler: ExpenseHandler,
  ) {}

  /** Platform-agnostic entry point — both Telegram and WhatsApp dispatchers call this */
  async handlePhotoBuffer(chatId: string, buffer: Buffer): Promise<void> {
    this.conversation.setState(chatId, ConversationState.WAITING_RECEIPT);
    const processingMsg = await this.messaging.sendText(
      chatId,
      this.i18n.get('receipt.processing'),
      { parseMode: 'MarkdownV2' },
    );
    try {
      this.conversation.setImageBuffer(chatId, buffer);
      const extracted = await this.ai.extractFromImage(buffer);
      if (!extracted.fecha) {
        extracted.fecha = new Date().toISOString().split('T')[0];
      }
      this.conversation.updatePending(chatId, extracted);
      this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
      await this.messaging.deleteMessage(chatId, processingMsg.messageId);
      await this.expenseHandler.showConfirmation(chatId);
    } catch (err) {
      this.logger.error('Photo handling error', err);
      await this.messaging.sendText(chatId, this.i18n.get('receipt.error'), { parseMode: 'MarkdownV2' });
    }
  }
}
```

- [ ] **Step 2: Check TypeScript errors in receipt.handler only**

```bash
pnpm exec tsc --noEmit 2>&1 | grep receipt.handler
```

Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add src/telegram/handlers/receipt.handler.ts
git commit -m "refactor: ReceiptHandler uses MessagingPort + handlePhotoBuffer entry point"
```

---

## Task 9: Refactor QueryHandler to use MessagingPort

**Files:**
- Modify: `src/telegram/handlers/query.handler.ts`

- [ ] **Step 1: Replace the file content**

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  MessagingPort,
  MESSAGING_PORT,
} from '../../shared/messaging/messaging-port.interface';
import { SheetsService } from '../../google/sheets.service';
import { I18nService } from '../../i18n/i18n.service';
import { CATEGORY_LABEL } from '../../shared/categories';
import { StepMessenger } from '../step-messenger.service';

@Injectable()
export class QueryHandler {
  private readonly logger = new Logger(QueryHandler.name);

  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly sheets: SheetsService,
    private readonly i18n: I18nService,
    private readonly step: StepMessenger,
  ) {}

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  }

  private formatAmount(amount: number): string {
    return Math.round(amount)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  private formatDate(fecha: string): string {
    const [y, m, d] = fecha.split('-');
    return `${d}/${m}/${y.slice(2)}`;
  }

  async handleRecentExpenses(chatId: string): Promise<void> {
    try {
      const expenses = await this.sheets.getLastExpenses(5);
      if (!expenses.length) {
        await this.messaging.sendText(
          chatId,
          this.i18n.get('queries.no_expenses'),
          { parseMode: 'MarkdownV2' },
        );
        return;
      }
      const cards = expenses.map((exp) => {
        const date     = this.formatDate(exp.fecha);
        const amount   = `$${this.formatAmount(exp.monto)}`;
        const provider = exp.proveedor || '—';
        const category = CATEGORY_LABEL[exp.categoria ?? ''] ?? exp.categoria ?? '—';
        const line1 = `📅 ${this.escape(date)}  💰 *${this.escape(amount)}*`;
        const line2 = `🏪 ${this.escape(provider)} · ${this.escape(category)}`;
        return `${line1}\n${line2}`;
      });
      const title = this.i18n.get('queries.recent_title');
      await this.step.send(chatId, `${title}\n\n${cards.join('\n\n')}`, { parseMode: 'MarkdownV2' });
    } catch (err) {
      this.logger.error(`Get expenses error: ${(err as Error).message}`, (err as Error).stack);
      await this.messaging.sendText(chatId, this.i18n.get('queries.recent_error'), { parseMode: 'MarkdownV2' });
    }
  }

  async handleMonthlySummary(chatId: string): Promise<void> {
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const summary = await this.sheets.getMonthlySummary(yearMonth);
      const monthName = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString(
        'es-CO',
        { month: 'long', year: 'numeric' },
      );
      const title = this.i18n.get('queries.summary_title', { month: this.escape(monthName) });
      const totLine =
        `💰 *\\$${this.escape(this.formatAmount(summary.total))}*` +
        `  ·  🧾 ${String(summary.cantidadGastos)} gastos`;
      const C_CAT = 20;
      const C_AMT = 10;
      const divider = '─'.repeat(C_CAT + C_AMT + 1);
      const header  = 'Categoría'.padEnd(C_CAT + 1) + 'Valor'.padStart(C_AMT);
      const entries = Object.entries(summary.porCategoria) as [string, number][];
      entries.sort((a, b) => b[1] - a[1]);
      const rows = entries.map(([cat, amt]) => {
        const category = (CATEGORY_LABEL[cat] ?? cat).substring(0, C_CAT).padEnd(C_CAT + 1);
        const amount   = `$${this.formatAmount(amt)}`.padStart(C_AMT);
        return category + amount;
      });
      const table = '```\n' + [header, divider, ...rows].join('\n') + '\n```';
      await this.step.send(chatId, [title, '', totLine, '', table].join('\n'), { parseMode: 'MarkdownV2' });
    } catch (err) {
      this.logger.error(`Monthly summary error: ${(err as Error).message}`, (err as Error).stack);
      await this.messaging.sendText(chatId, this.i18n.get('queries.summary_error'), { parseMode: 'MarkdownV2' });
    }
  }
}
```

- [ ] **Step 2: Check TypeScript errors in query.handler only**

```bash
pnpm exec tsc --noEmit 2>&1 | grep query.handler
```

Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add src/telegram/handlers/query.handler.ts
git commit -m "refactor: QueryHandler uses MessagingPort, chatId: string"
```

---

## Task 10: Refactor TelegramDispatcher + TelegramService

**Files:**
- Modify: `src/telegram/telegram.dispatcher.ts`
- Modify: `src/telegram/telegram.service.ts`

Key changes:
- All `chatId: number` → `chatId: string` (convert at boundary with `String(msg.chat.id)`)
- Replace `this.bot.sendMessage(chatId, '...')` with `this.messaging.sendText(String(chatId), '...')`
- Inject `MESSAGING_PORT` in dispatcher for error messages
- `TelegramService`: photo and voice download stays here (Telegram-specific); calls `receipt.handlePhotoBuffer()`
- Add `/vincular` command routing + contact message handling in dispatcher

- [ ] **Step 1: Replace TelegramDispatcher**

```typescript
// src/telegram/telegram.dispatcher.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import {
  MessagingPort,
  MESSAGING_PORT,
} from '../shared/messaging/messaging-port.interface';
import { ConversationService } from '../conversation/conversation.service';
import { ConversationState } from '../conversation/conversation-state.enum';
import { AiService } from '../ai/ai.service';
import { I18nService } from '../i18n/i18n.service';
import { MenuHandler } from './handlers/menu.handler';
import { ExpenseHandler } from './handlers/expense.handler';
import { ReceiptHandler } from './handlers/receipt.handler';
import { QueryHandler } from './handlers/query.handler';
import { PhoneLinkService } from '../whatsapp/phone-link.service';

const EXPENSE_STATES = new Set([
  ConversationState.WAITING_AMOUNT,
  ConversationState.WAITING_PROVIDER,
  ConversationState.WAITING_CATEGORY,
  ConversationState.WAITING_DESCRIPTION,
  ConversationState.WAITING_RECEIPT,
  ConversationState.WAITING_VOICE_EXPENSE,
  ConversationState.WAITING_CONFIRMATION,
  ConversationState.EDITING_FIELD,
]);

@Injectable()
export class TelegramDispatcher {
  private readonly logger = new Logger(TelegramDispatcher.name);

  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
    private readonly ai: AiService,
    private readonly i18n: I18nService,
    private readonly menu: MenuHandler,
    private readonly expense: ExpenseHandler,
    private readonly receipt: ReceiptHandler,
    private readonly query: QueryHandler,
    private readonly phoneLink: PhoneLinkService,
  ) {}

  async dispatchMessage(msg: TelegramBot.Message): Promise<void> {
    const chatId = String(msg.chat.id);
    if (msg.from) {
      const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
      this.conversation.setUserName(chatId, name);
    }
    if (msg.message_id) {
      this.conversation.addUserMessageId(chatId, String(msg.message_id));
    }

    // Contact share — /vincular flow
    if (msg.contact && msg.contact.phone_number) {
      const phone = msg.contact.phone_number.replace(/\D/g, '');
      this.phoneLink.link(chatId, `+${phone}`);
      await this.messaging.sendText(chatId, '✅ ¡Cuenta vinculada! Ya puedes usar el bot desde WhatsApp también.');
      return;
    }

    if (msg.photo) {
      // Photo download is handled by TelegramService which calls receipt.handlePhotoBuffer
      return;
    }

    const text = msg.text?.trim() ?? '';

    if (/^\/start/.test(text)) return this.menu.showMenu(chatId);
    if (/^\/(cancel|cancelar)/.test(text)) return this.menu.handleCancel(chatId);
    if (/^\/(gastos|expenses)/.test(text)) return this.query.handleRecentExpenses(chatId);
    if (/^\/(mes|month)/.test(text)) return this.query.handleMonthlySummary(chatId);
    if (/^\/(gasto|expense)/.test(text)) return this.menu.startExpenseFlow(chatId);
    if (/^\/vincular/.test(text)) return this.menu.showVincularPrompt(chatId);
    if (text.startsWith('/')) return;

    return this.dispatchTextInput(chatId, text);
  }

  async dispatchVoice(chatId: string, buffer: Buffer, voiceMessageId?: string): Promise<void> {
    const processingMsg = await this.messaging.sendText(
      chatId,
      this.i18n.get('general.processing'),
      { parseMode: 'MarkdownV2' },
    );
    try {
      const text = await this.ai.transcribeAudio(buffer);
      await this.messaging.deleteMessage(chatId, processingMsg.messageId);
      if (!text) return this.menu.handleUnknown(chatId);
      const ctx = this.conversation.getContext(chatId);
      const extractStates = new Set([ConversationState.WAITING_VOICE_EXPENSE, ConversationState.IDLE]);
      if (extractStates.has(ctx.state)) {
        const extracted = await this.ai.extractFromText(text);
        if (!extracted.fecha) extracted.fecha = new Date().toISOString().split('T')[0];
        this.conversation.reset(chatId);
        if (voiceMessageId) this.conversation.addUserMessageId(chatId, voiceMessageId);
        this.conversation.updatePending(chatId, extracted);
        this.conversation.setState(chatId, ConversationState.WAITING_CONFIRMATION);
        return this.expense.showConfirmation(chatId);
      }
      return this.dispatchTextInput(chatId, text);
    } catch (err) {
      this.logger.error(`AI dispatch failed for chat ${chatId}`, err);
      this.conversation.reset(chatId);
      await this.messaging.sendText(chatId, '⚠️ Ocurrió un error. Por favor intenta de nuevo o usa /cancel.');
    }
  }

  async dispatchCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = String(query.message!.chat.id);
    if (query.from) {
      const name = query.from.username ? `@${query.from.username}` : query.from.first_name;
      this.conversation.setUserName(chatId, name);
    }
    return this.routeCallbackData(chatId, query.data ?? '');
  }

  /** Shared callback routing — used by both Telegram and WhatsApp dispatchers */
  async routeCallbackData(chatId: string, data: string): Promise<void> {
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
    if (data === 'edit_menu')   return this.expense.showEditMenu(chatId);
    if (data.startsWith('edit_'))
      return this.expense.handleEditField(chatId, data.replace('edit_', ''));
    this.logger.warn(`Unknown callback data: ${data}`);
  }

  private async dispatchTextInput(chatId: string, text: string): Promise<void> {
    const ctx = this.conversation.getContext(chatId);
    if (EXPENSE_STATES.has(ctx.state)) return this.expense.handleText(chatId, text);
    try {
      const intent = await this.ai.classifyIntent(text);
      if (intent === 'MANUAL_EXPENSE') return this.menu.startExpenseFlow(chatId);
      if (intent === 'QUERY_EXPENSES') return this.query.handleRecentExpenses(chatId);
      if (intent === 'MONTHLY_SUMMARY') return this.query.handleMonthlySummary(chatId);
      if (intent === 'GREETING') return this.menu.showMenu(chatId);
      return this.menu.handleUnknown(chatId);
    } catch (err) {
      this.logger.error(`AI dispatch failed for chat ${chatId}`, err);
      this.conversation.reset(chatId);
      await this.messaging.sendText(chatId, '⚠️ Ocurrió un error. Por favor intenta de nuevo o usa /cancel.');
    }
  }
}
```

- [ ] **Step 2: Update TelegramService to use string chatIds and call handlePhotoBuffer**

Replace `src/telegram/telegram.service.ts`:

```typescript
import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { BOT } from './bot.provider';
import { TelegramDispatcher } from './telegram.dispatcher';
import { ReceiptHandler } from './handlers/receipt.handler';
import { TELEGRAM_WEBHOOK_PATH } from './telegram.constants';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly config: ConfigService,
    private readonly dispatcher: TelegramDispatcher,
    private readonly receipt: ReceiptHandler,
  ) {}

  async onModuleInit() {
    this.bot.on('message', async (msg) => {
      try {
        const chatId = String(msg.chat.id);
        if (msg.voice) {
          const fileLink = await this.bot.getFileLink(msg.voice.file_id);
          const res = await axios.get<ArrayBuffer>(fileLink, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(res.data);
          return await this.dispatcher.dispatchVoice(chatId, buffer, String(msg.message_id));
        }
        if (msg.photo) {
          await this.dispatcher.dispatchMessage(msg); // track user message + username
          const photo = msg.photo[msg.photo.length - 1];
          const fileLink = await this.bot.getFileLink(photo.file_id);
          const res = await axios.get(fileLink, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(res.data as ArrayBuffer);
          return await this.receipt.handlePhotoBuffer(chatId, buffer);
        }
        await this.dispatcher.dispatchMessage(msg);
      } catch (err) {
        this.logger.error('Message dispatch error', err);
      }
    });

    this.bot.on('callback_query', async (query) => {
      await this.bot.answerCallbackQuery(query.id).catch(() => null);
      this.dispatcher
        .dispatchCallback(query)
        .catch((err) => this.logger.error('Callback dispatch error', err));
    });

    const transport = this.config.get<'polling' | 'webhook'>('TELEGRAM_TRANSPORT', 'polling');

    if (transport === 'webhook') {
      const webhookUrl = this.config.get<string>('TELEGRAM_WEBHOOK_URL');
      if (!webhookUrl) {
        this.logger.error('TELEGRAM_TRANSPORT=webhook requires TELEGRAM_WEBHOOK_URL');
        throw new Error('Missing TELEGRAM_WEBHOOK_URL');
      }
      this.validateWebhookUrl(webhookUrl);
      const webhookSecret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
      await this.bot.setWebHook(webhookUrl, { secret_token: webhookSecret || undefined });
      this.logger.log(`Telegram bot started (webhook: ${webhookUrl})`);
      return;
    }

    await this.bot.deleteWebHook().catch(() => {
      this.logger.warn('Could not delete webhook before polling startup');
    });
    await this.bot.startPolling();
    this.logger.log('Telegram bot started (polling)');
  }

  handleWebhookUpdate(update: TelegramBot.Update): void {
    this.bot.processUpdate(update);
  }

  private validateWebhookUrl(webhookUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      throw new Error('Invalid TELEGRAM_WEBHOOK_URL');
    }
    if (parsed.protocol !== 'https:') throw new Error('TELEGRAM_WEBHOOK_URL must use https://');
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    if (pathname !== TELEGRAM_WEBHOOK_PATH)
      throw new Error(`TELEGRAM_WEBHOOK_URL path must be ${TELEGRAM_WEBHOOK_PATH}`);
  }
}
```

- [ ] **Step 3: Check TypeScript errors**

```bash
pnpm exec tsc --noEmit 2>&1 | grep -E "telegram\.(dispatcher|service)"
```

Expected: errors will mention `PhoneLinkService` not found (Task 11 creates it). Other errors should be 0.

- [ ] **Step 4: Commit**

```bash
git add src/telegram/telegram.dispatcher.ts src/telegram/telegram.service.ts
git commit -m "refactor: TelegramDispatcher uses string chatIds and MessagingPort"
```

---

## Task 11: Create PhoneLinkService + update TelegramModule

**Files:**
- Create: `src/whatsapp/phone-link.service.ts`
- Create: `src/whatsapp/phone-link.service.spec.ts`
- Modify: `src/telegram/telegram.module.ts`

- [ ] **Step 1: Write the failing test**

Create `src/whatsapp/phone-link.service.spec.ts`:

```typescript
import { PhoneLinkService } from './phone-link.service';

describe('PhoneLinkService', () => {
  let service: PhoneLinkService;

  beforeEach(() => {
    service = new PhoneLinkService();
  });

  it('resolveToCanonical returns phone if no link exists', () => {
    expect(service.resolveToCanonical('+573001234567')).toBe('+573001234567');
  });

  it('link and resolveToCanonical returns telegramChatId when linked', () => {
    service.link('12345', '+573001234567');
    expect(service.resolveToCanonical('+573001234567')).toBe('12345');
  });

  it('resolveToCanonical normalizes numbers (strips non-digits except leading +)', () => {
    service.link('99', '+57 300 123-4567');
    expect(service.resolveToCanonical('+573001234567')).toBe('99');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- --testPathPattern=phone-link.service.spec
```

Expected: FAIL — `PhoneLinkService` doesn't exist yet.

- [ ] **Step 3: Implement PhoneLinkService**

Create `src/whatsapp/phone-link.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class PhoneLinkService {
  /** phone (normalized) → telegramChatId */
  private readonly links = new Map<string, string>();

  private normalize(phone: string): string {
    // Keep leading + and digits only
    const digits = phone.replace(/[^\d+]/g, '');
    return digits.startsWith('+') ? digits : `+${digits}`;
  }

  link(telegramChatId: string, phone: string): void {
    this.links.set(this.normalize(phone), telegramChatId);
  }

  /** Returns telegramChatId if phone is linked, otherwise returns phone as-is */
  resolveToCanonical(phone: string): string {
    return this.links.get(this.normalize(phone)) ?? phone;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- --testPathPattern=phone-link.service.spec
```

Expected: all 3 tests pass.

- [ ] **Step 5: Update TelegramModule — add TelegramAdapter, PhoneLinkService, MESSAGING_PORT**

Replace `src/telegram/telegram.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BotProvider } from './bot.provider';
import { TelegramAdapter } from './telegram.adapter';
import { TelegramService } from './telegram.service';
import { TelegramDispatcher } from './telegram.dispatcher';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { MenuHandler } from './handlers/menu.handler';
import { ExpenseHandler } from './handlers/expense.handler';
import { ReceiptHandler } from './handlers/receipt.handler';
import { QueryHandler } from './handlers/query.handler';
import { StepMessenger } from './step-messenger.service';
import { ConversationModule } from '../conversation/conversation.module';
import { AiModule } from '../ai/ai.module';
import { GoogleModule } from '../google/google.module';
import { PhoneLinkService } from '../whatsapp/phone-link.service';
import { MESSAGING_PORT } from '../shared/messaging/messaging-port.interface';

@Module({
  imports: [ConfigModule, ConversationModule, AiModule, GoogleModule],
  controllers: [TelegramWebhookController],
  providers: [
    BotProvider,
    TelegramAdapter,
    { provide: MESSAGING_PORT, useExisting: TelegramAdapter },
    PhoneLinkService,
    TelegramService,
    TelegramDispatcher,
    StepMessenger,
    MenuHandler,
    ExpenseHandler,
    ReceiptHandler,
    QueryHandler,
  ],
  exports: [PhoneLinkService],
})
export class TelegramModule {}
```

- [ ] **Step 6: Verify TypeScript compiles cleanly for the Telegram side**

```bash
pnpm exec tsc --noEmit 2>&1 | grep -v "node_modules" | head -30
```

Expected: 0 errors (or only errors in whatsapp/ files not yet created).

- [ ] **Step 7: Run all tests**

```bash
pnpm test
```

Expected: all existing tests pass (the `openrouter.connector.spec.ts` and the new adapter + phone-link tests).

- [ ] **Step 8: Commit**

```bash
git add src/whatsapp/phone-link.service.ts src/whatsapp/phone-link.service.spec.ts src/telegram/telegram.module.ts
git commit -m "feat: PhoneLinkService + wire TelegramModule with MessagingPort/TelegramAdapter"
```

---

## Task 12: Create WhatsAppAdapter

**Files:**
- Create: `src/whatsapp/whatsapp.adapter.ts`
- Create: `src/whatsapp/whatsapp.adapter.spec.ts`

The adapter wraps the Twilio SDK. `sendMenu` uses Twilio's interactive list message. `deleteMessage` is a no-op (WhatsApp limitation). `editText` sends a new message.

- [ ] **Step 1: Write the failing test**

Create `src/whatsapp/whatsapp.adapter.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WhatsAppAdapter } from './whatsapp.adapter';

const mockCreate = jest.fn();

jest.mock('twilio', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

describe('WhatsAppAdapter', () => {
  let adapter: WhatsAppAdapter;

  beforeEach(async () => {
    mockCreate.mockResolvedValue({ sid: 'SM123' });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, string> = {
                TWILIO_ACCOUNT_SID: 'ACtest',
                TWILIO_AUTH_TOKEN: 'authtest',
                TWILIO_WHATSAPP_NUMBER: 'whatsapp:+14155238886',
              };
              return map[key];
            },
          },
        },
      ],
    }).compile();
    adapter = module.get(WhatsAppAdapter);
    adapter.onModuleInit();
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ sid: 'SM123' });
  });

  it('sendText calls twilio messages.create with correct params', async () => {
    const result = await adapter.sendText('+573001234567', 'hello');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+573001234567',
        body: 'hello',
      }),
    );
    expect(result.messageId).toBe('SM123');
  });

  it('deleteMessage is a no-op and does not call twilio', async () => {
    await adapter.deleteMessage('+57300', 'SM999');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('editText sends a new message', async () => {
    await adapter.editText('+57300', 'SM999', 'updated text');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'updated text' }),
    );
  });

  it('sendMenu sends interactive list message', async () => {
    await adapter.sendMenu('+57300', 'Pick one:', [
      { title: 'Section A', options: [{ id: 'opt1', label: 'Option 1' }] },
    ]);
    const call = mockCreate.mock.calls[0][0];
    expect(call.from).toBe('whatsapp:+14155238886');
    expect(call.to).toBe('whatsapp:+57300');
    // Either interactiveData or body with fallback
    expect(call.body !== undefined || call.interactiveData !== undefined).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- --testPathPattern=whatsapp.adapter.spec
```

Expected: FAIL — `WhatsAppAdapter` doesn't exist yet.

- [ ] **Step 3: Implement WhatsAppAdapter**

Create `src/whatsapp/whatsapp.adapter.ts`:

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import {
  MessagingPort,
  MenuSection,
  SentMessage,
} from '../shared/messaging/messaging-port.interface';

@Injectable()
export class WhatsAppAdapter implements MessagingPort, OnModuleInit {
  private readonly logger = new Logger(WhatsAppAdapter.name);
  private client!: ReturnType<typeof Twilio>;
  private fromNumber!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID')!;
    const authToken  = this.config.get<string>('TWILIO_AUTH_TOKEN')!;
    this.fromNumber  = this.config.get<string>('TWILIO_WHATSAPP_NUMBER')!;
    this.client = Twilio(accountSid, authToken);
  }

  async sendText(
    chatId: string,
    text: string,
    _opts?: { parseMode?: 'MarkdownV2' | 'HTML' },
  ): Promise<SentMessage> {
    const msg = await this.client.messages.create({
      from: this.fromNumber,
      to: `whatsapp:${chatId}`,
      body: this.stripMarkdown(text),
    });
    return { messageId: msg.sid };
  }

  async editText(
    chatId: string,
    _messageId: string,
    text: string,
    opts?: { parseMode?: 'MarkdownV2' | 'HTML' },
  ): Promise<SentMessage> {
    return this.sendText(chatId, text, opts);
  }

  async deleteMessage(_chatId: string, _messageId: string): Promise<void> {
    // WhatsApp does not support deleting messages sent by the bot
  }

  async sendMenu(chatId: string, text: string, sections: MenuSection[]): Promise<SentMessage> {
    const interactiveData = {
      type: 'list',
      body: { text: this.stripMarkdown(text) },
      action: {
        button: 'Seleccionar',
        sections: sections.map((s) => ({
          title: (s.title || 'Opciones').substring(0, 24),
          rows: s.options.slice(0, 10).map((o) => ({
            id: o.id.substring(0, 256),
            title: o.label.substring(0, 24),
            description: (o.description ?? '').substring(0, 72),
          })),
        })),
      },
    };

    try {
      const msg = await (this.client.messages.create as (params: Record<string, unknown>) => Promise<{ sid: string }>)({
        from: this.fromNumber,
        to: `whatsapp:${chatId}`,
        body: this.stripMarkdown(text),
        interactiveData: JSON.stringify(interactiveData),
      });
      return { messageId: msg.sid };
    } catch (err) {
      this.logger.warn('Interactive list failed, falling back to numbered text', err);
      return this.sendNumberedMenu(chatId, text, sections);
    }
  }

  async sendPhoto(chatId: string, url: string, caption?: string): Promise<SentMessage> {
    const msg = await this.client.messages.create({
      from: this.fromNumber,
      to: `whatsapp:${chatId}`,
      body: caption ? this.stripMarkdown(caption) : '',
      mediaUrl: [url],
    });
    return { messageId: msg.sid };
  }

  private async sendNumberedMenu(chatId: string, text: string, sections: MenuSection[]): Promise<SentMessage> {
    const allOptions = sections.flatMap((s) => s.options);
    const lines = [this.stripMarkdown(text), ''];
    allOptions.forEach((o, i) => lines.push(`${i + 1}. ${o.label}`));
    return this.sendText(chatId, lines.join('\n'));
  }

  private stripMarkdown(text: string): string {
    return text
      .replace(/\\([_*[\]()~`>#+=|{}.!\\-])/g, '$1') // unescape MarkdownV2
      .replace(/[*_~`]/g, '');                          // strip remaining formatting chars
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- --testPathPattern=whatsapp.adapter.spec
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp/whatsapp.adapter.ts src/whatsapp/whatsapp.adapter.spec.ts
git commit -m "feat: WhatsAppAdapter implementing MessagingPort via Twilio"
```

---

## Task 13: Create WhatsAppDispatcher

**Files:**
- Create: `src/whatsapp/whatsapp.dispatcher.ts`
- Create: `src/whatsapp/whatsapp.dispatcher.spec.ts`

The dispatcher parses Twilio webhook payloads and routes to the same handlers as Telegram. Media (photos, audio) is downloaded using axios with Basic Auth. `ButtonPayload` from interactive list responses is treated as callback data.

- [ ] **Step 1: Write the failing test**

Create `src/whatsapp/whatsapp.dispatcher.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WhatsAppDispatcher } from './whatsapp.dispatcher';
import { MenuHandler } from '../telegram/handlers/menu.handler';
import { ExpenseHandler } from '../telegram/handlers/expense.handler';
import { ReceiptHandler } from '../telegram/handlers/receipt.handler';
import { QueryHandler } from '../telegram/handlers/query.handler';
import { TelegramDispatcher } from '../telegram/telegram.dispatcher';
import { ConversationService } from '../conversation/conversation.service';
import { AiService } from '../ai/ai.service';
import { PhoneLinkService } from './phone-link.service';

const mockMenu = { showMenu: jest.fn(), handleCancel: jest.fn(), handleUnknown: jest.fn(), startExpenseFlow: jest.fn() };
const mockExpense = { showConfirmation: jest.fn() };
const mockReceipt = { handlePhotoBuffer: jest.fn() };
const mockQuery = { handleRecentExpenses: jest.fn() };
const mockDispatcher = { routeCallbackData: jest.fn(), dispatchVoice: jest.fn() };
const mockConversation = { setUserName: jest.fn(), addUserMessageId: jest.fn() };
const mockAi = { classifyIntent: jest.fn() };
const mockPhoneLink = { resolveToCanonical: jest.fn((p: string) => p) };

jest.mock('axios');
import axios from 'axios';
const mockAxiosGet = axios.get as jest.Mock;

describe('WhatsAppDispatcher', () => {
  let dispatcher: WhatsAppDispatcher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppDispatcher,
        { provide: MenuHandler,         useValue: mockMenu },
        { provide: ExpenseHandler,      useValue: mockExpense },
        { provide: ReceiptHandler,      useValue: mockReceipt },
        { provide: QueryHandler,        useValue: mockQuery },
        { provide: TelegramDispatcher,  useValue: mockDispatcher },
        { provide: ConversationService, useValue: mockConversation },
        { provide: AiService,           useValue: mockAi },
        { provide: PhoneLinkService,    useValue: mockPhoneLink },
        { provide: ConfigService,       useValue: { get: jest.fn().mockReturnValue('ACtest:authtest') } },
      ],
    }).compile();
    dispatcher = module.get(WhatsAppDispatcher);
    jest.clearAllMocks();
    mockPhoneLink.resolveToCanonical.mockImplementation((p: string) => p);
  });

  it('routes ButtonPayload as callback data', async () => {
    await dispatcher.dispatch({
      From: 'whatsapp:+573001234567',
      Body: 'Confirmar',
      ButtonPayload: 'confirm_yes',
      NumMedia: '0',
    });
    expect(mockDispatcher.routeCallbackData).toHaveBeenCalledWith('+573001234567', 'confirm_yes');
  });

  it('routes /start command to showMenu', async () => {
    await dispatcher.dispatch({
      From: 'whatsapp:+573001234567',
      Body: '/start',
      ButtonPayload: '',
      NumMedia: '0',
    });
    expect(mockMenu.showMenu).toHaveBeenCalledWith('+573001234567');
  });

  it('resolves canonical chatId via PhoneLinkService', async () => {
    mockPhoneLink.resolveToCanonical.mockReturnValue('999');
    await dispatcher.dispatch({
      From: 'whatsapp:+573001234567',
      Body: '/start',
      ButtonPayload: '',
      NumMedia: '0',
    });
    expect(mockMenu.showMenu).toHaveBeenCalledWith('999');
  });

  it('routes photo to handlePhotoBuffer after download', async () => {
    mockAxiosGet.mockResolvedValue({ data: Buffer.from('fake-image') });
    await dispatcher.dispatch({
      From: 'whatsapp:+573001234567',
      Body: '',
      ButtonPayload: '',
      NumMedia: '1',
      MediaUrl0: 'https://example.com/img.jpg',
      MediaContentType0: 'image/jpeg',
    });
    expect(mockReceipt.handlePhotoBuffer).toHaveBeenCalledWith(
      '+573001234567',
      expect.any(Buffer),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- --testPathPattern=whatsapp.dispatcher.spec
```

Expected: FAIL — `WhatsAppDispatcher` doesn't exist yet.

- [ ] **Step 3: Implement WhatsAppDispatcher**

Create `src/whatsapp/whatsapp.dispatcher.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ConversationService } from '../conversation/conversation.service';
import { AiService } from '../ai/ai.service';
import { MenuHandler } from '../telegram/handlers/menu.handler';
import { ExpenseHandler } from '../telegram/handlers/expense.handler';
import { ReceiptHandler } from '../telegram/handlers/receipt.handler';
import { QueryHandler } from '../telegram/handlers/query.handler';
import { TelegramDispatcher } from '../telegram/telegram.dispatcher';
import { ConversationState } from '../conversation/conversation-state.enum';
import { PhoneLinkService } from './phone-link.service';

export interface TwilioWebhookPayload {
  From: string;
  Body: string;
  ButtonPayload?: string;
  NumMedia: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
  MessageSid?: string;
}

const EXPENSE_STATES = new Set([
  ConversationState.WAITING_AMOUNT,
  ConversationState.WAITING_PROVIDER,
  ConversationState.WAITING_CATEGORY,
  ConversationState.WAITING_DESCRIPTION,
  ConversationState.WAITING_RECEIPT,
  ConversationState.WAITING_VOICE_EXPENSE,
  ConversationState.WAITING_CONFIRMATION,
  ConversationState.EDITING_FIELD,
]);

@Injectable()
export class WhatsAppDispatcher {
  private readonly logger = new Logger(WhatsAppDispatcher.name);
  private readonly twilioAccountSid: string;
  private readonly twilioAuthToken: string;

  constructor(
    private readonly config: ConfigService,
    private readonly conversation: ConversationService,
    private readonly ai: AiService,
    private readonly menu: MenuHandler,
    private readonly expense: ExpenseHandler,
    private readonly receipt: ReceiptHandler,
    private readonly query: QueryHandler,
    private readonly telegramDispatcher: TelegramDispatcher,
    private readonly phoneLink: PhoneLinkService,
  ) {
    this.twilioAccountSid = this.config.get<string>('TWILIO_ACCOUNT_SID') ?? '';
    this.twilioAuthToken  = this.config.get<string>('TWILIO_AUTH_TOKEN') ?? '';
  }

  async dispatch(payload: TwilioWebhookPayload): Promise<void> {
    const rawPhone = payload.From.replace(/^whatsapp:/, '');
    const chatId = this.phoneLink.resolveToCanonical(rawPhone);
    const messageSid = payload.MessageSid;

    if (messageSid) this.conversation.addUserMessageId(chatId, messageSid);

    // Interactive list response — route as callback
    if (payload.ButtonPayload) {
      return this.telegramDispatcher.routeCallbackData(chatId, payload.ButtonPayload);
    }

    // Media messages
    const numMedia = parseInt(payload.NumMedia, 10) || 0;
    if (numMedia > 0 && payload.MediaUrl0 && payload.MediaContentType0) {
      const contentType = payload.MediaContentType0;
      const buffer = await this.downloadMedia(payload.MediaUrl0);
      if (contentType.startsWith('image/')) {
        return this.receipt.handlePhotoBuffer(chatId, buffer);
      }
      if (contentType.startsWith('audio/')) {
        return this.telegramDispatcher.dispatchVoice(chatId, buffer, messageSid);
      }
    }

    const text = payload.Body?.trim() ?? '';

    // Commands
    if (/^\/start/.test(text)) return this.menu.showMenu(chatId);
    if (/^\/(cancel|cancelar)/.test(text)) return this.menu.handleCancel(chatId);
    if (/^\/(gastos|expenses)/.test(text)) return this.query.handleRecentExpenses(chatId);
    if (/^\/(mes|month)/.test(text)) return this.query.handleMonthlySummary(chatId);
    if (/^\/(gasto|expense)/.test(text)) return this.menu.startExpenseFlow(chatId);
    if (text.startsWith('/')) return;

    // Text input
    const ctx = this.conversation.getContext(chatId);
    if (EXPENSE_STATES.has(ctx.state)) return this.expense.handleText(chatId, text);

    try {
      const intent = await this.ai.classifyIntent(text);
      if (intent === 'MANUAL_EXPENSE') return this.menu.startExpenseFlow(chatId);
      if (intent === 'QUERY_EXPENSES') return this.query.handleRecentExpenses(chatId);
      if (intent === 'MONTHLY_SUMMARY') return this.query.handleMonthlySummary(chatId);
      if (intent === 'GREETING') return this.menu.showMenu(chatId);
      return this.menu.handleUnknown(chatId);
    } catch (err) {
      this.logger.error(`AI dispatch failed for WhatsApp ${chatId}`, err);
    }
  }

  private async downloadMedia(url: string): Promise<Buffer> {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      auth: { username: this.twilioAccountSid, password: this.twilioAuthToken },
    });
    return Buffer.from(res.data);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- --testPathPattern=whatsapp.dispatcher.spec
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp/whatsapp.dispatcher.ts src/whatsapp/whatsapp.dispatcher.spec.ts
git commit -m "feat: WhatsAppDispatcher routes Twilio webhooks to shared handlers"
```

---

## Task 14: Create WhatsAppWebhookController + WhatsAppModule

**Files:**
- Create: `src/whatsapp/whatsapp-webhook.controller.ts`
- Create: `src/whatsapp/whatsapp.module.ts`

- [ ] **Step 1: Create WhatsAppWebhookController**

```typescript
// src/whatsapp/whatsapp-webhook.controller.ts
import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Twilio from 'twilio';
import { WhatsAppDispatcher, TwilioWebhookPayload } from './whatsapp.dispatcher';

@Controller('whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dispatcher: WhatsAppDispatcher,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  handleWebhook(
    @Body() payload: TwilioWebhookPayload,
    @Headers('x-twilio-signature') twilioSignature?: string,
  ): string {
    const authToken  = this.config.get<string>('TWILIO_AUTH_TOKEN') ?? '';
    const webhookUrl = this.config.get<string>('WHATSAPP_WEBHOOK_URL') ?? '';

    if (webhookUrl && twilioSignature) {
      const isValid = Twilio.validateRequest(
        authToken,
        twilioSignature,
        webhookUrl,
        payload as unknown as Record<string, string>,
      );
      if (!isValid) {
        throw new UnauthorizedException('Invalid Twilio signature');
      }
    }

    // Process async — respond immediately
    this.dispatcher.dispatch(payload).catch((err) =>
      this.logger.error('WhatsApp dispatch error', err),
    );

    // Twilio expects empty TwiML or plain 200 response
    return '<Response></Response>';
  }
}
```

- [ ] **Step 2: Create WhatsAppModule**

```typescript
// src/whatsapp/whatsapp.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsAppAdapter } from './whatsapp.adapter';
import { WhatsAppDispatcher } from './whatsapp.dispatcher';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { PhoneLinkService } from './phone-link.service';
import { ConversationModule } from '../conversation/conversation.module';
import { AiModule } from '../ai/ai.module';
import { GoogleModule } from '../google/google.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MenuHandler } from '../telegram/handlers/menu.handler';
import { ExpenseHandler } from '../telegram/handlers/expense.handler';
import { ReceiptHandler } from '../telegram/handlers/receipt.handler';
import { QueryHandler } from '../telegram/handlers/query.handler';
import { StepMessenger } from '../telegram/step-messenger.service';
import { TelegramDispatcher } from '../telegram/telegram.dispatcher';
import { MESSAGING_PORT } from '../shared/messaging/messaging-port.interface';

@Module({
  imports: [ConfigModule, ConversationModule, AiModule, GoogleModule, TelegramModule],
  controllers: [WhatsAppWebhookController],
  providers: [
    WhatsAppAdapter,
    { provide: MESSAGING_PORT, useExisting: WhatsAppAdapter },
    WhatsAppDispatcher,
    StepMessenger,
    MenuHandler,
    ExpenseHandler,
    ReceiptHandler,
    QueryHandler,
    TelegramDispatcher,
  ],
})
export class WhatsAppModule {}
```

Note: `WhatsAppModule` imports `TelegramModule` to get `PhoneLinkService` (exported from `TelegramModule`). It also provides its own instances of all handlers wired to `WhatsAppAdapter` via `MESSAGING_PORT`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit 2>&1 | grep -v "node_modules" | head -30
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/whatsapp/whatsapp-webhook.controller.ts src/whatsapp/whatsapp.module.ts
git commit -m "feat: WhatsAppWebhookController and WhatsAppModule"
```

---

## Task 15: Update AppModule, config schema, and .env.example

**Files:**
- Modify: `src/app.module.ts`
- Modify: `src/config/config.schema.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add WhatsAppModule to AppModule**

Replace `src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { configSchema } from './config/config.schema';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { I18nModule } from './i18n/i18n.module';
import { ConversationModule } from './conversation/conversation.module';
import { GoogleModule } from './google/google.module';
import { AiModule } from './ai/ai.module';
import { TelegramModule } from './telegram/telegram.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: configSchema }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
      },
    }),
    I18nModule,
    ConversationModule,
    GoogleModule,
    AiModule,
    TelegramModule,
    WhatsAppModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
```

- [ ] **Step 2: Add Twilio variables to config schema**

Replace `src/config/config.schema.ts`:

```typescript
import * as Joi from 'joi';

export const configSchema = Joi.object({
  TELEGRAM_BOT_TOKEN: Joi.string().required(),
  TELEGRAM_TRANSPORT: Joi.string().valid('polling', 'webhook').default('polling'),
  TELEGRAM_WEBHOOK_URL: Joi.string().uri().optional(),
  TELEGRAM_WEBHOOK_SECRET: Joi.string().optional(),
  TWILIO_ACCOUNT_SID: Joi.string().optional(),
  TWILIO_AUTH_TOKEN: Joi.string().optional(),
  TWILIO_WHATSAPP_NUMBER: Joi.string().optional(),
  WHATSAPP_WEBHOOK_URL: Joi.string().uri().optional(),
  OPENROUTER_API_KEY: Joi.string().required(),
  GOOGLE_APPLICATION_CREDENTIALS: Joi.string().optional(),
  GOOGLE_CLIENT_EMAIL: Joi.string().email().optional(),
  GOOGLE_PRIVATE_KEY: Joi.string().optional(),
  GOOGLE_SHEET_ID: Joi.string().required(),
  GOOGLE_DRIVE_FOLDER_ID: Joi.string().optional(),
  PORT: Joi.number().default(3000),
});
```

- [ ] **Step 3: Update .env.example**

Replace `.env.example`:

```
TELEGRAM_BOT_TOKEN=
OPENROUTER_API_KEY=sk-or-v1-your-key-here
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SHEET_ID=
GOOGLE_DRIVE_FOLDER_ID=
PORT=3000

# WhatsApp via Twilio (optional — only needed if using WhatsApp channel)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
WHATSAPP_WEBHOOK_URL=https://your-domain.com/whatsapp/webhook
```

- [ ] **Step 4: Full TypeScript compile check**

```bash
pnpm exec tsc --noEmit 2>&1 | grep -v "node_modules"
```

Expected: 0 errors.

- [ ] **Step 5: Run all tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app.module.ts src/config/config.schema.ts .env.example
git commit -m "feat: wire WhatsAppModule into AppModule, add Twilio config vars"
```

---

## Task 16: Fix circular dependency between TelegramModule and WhatsAppModule

`WhatsAppModule` imports `TelegramModule` (for `PhoneLinkService`) but `TelegramModule` imports `PhoneLinkService` from `src/whatsapp/`. This creates a circular import at the file level. Fix by moving `PhoneLinkService` to a shared location.

**Files:**
- Modify: `src/telegram/telegram.module.ts` (import path)
- Modify: `src/telegram/telegram.dispatcher.ts` (import path)
- Modify: `src/whatsapp/whatsapp.module.ts` (remove TelegramModule dependency)

- [ ] **Step 1: Move PhoneLinkService import to eliminate circular dependency**

The `PhoneLinkService` file stays at `src/whatsapp/phone-link.service.ts`. The circular dependency comes from `TelegramModule` providing `PhoneLinkService` while `WhatsAppModule` imports `TelegramModule`.

Fix: export `PhoneLinkService` from `WhatsAppModule` instead, and have `TelegramModule` import `WhatsAppModule` only for `PhoneLinkService`. But this still creates a circular module dependency.

Better fix: make `PhoneLinkService` a **global** provider at the `AppModule` level, imported by a new lightweight `PhoneLinkModule`.

Create `src/whatsapp/phone-link.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PhoneLinkService } from './phone-link.service';

@Module({
  providers: [PhoneLinkService],
  exports: [PhoneLinkService],
})
export class PhoneLinkModule {}
```

- [ ] **Step 2: Update TelegramModule to import PhoneLinkModule**

Replace the providers/imports in `src/telegram/telegram.module.ts` — import `PhoneLinkModule` instead of providing `PhoneLinkService` directly:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BotProvider } from './bot.provider';
import { TelegramAdapter } from './telegram.adapter';
import { TelegramService } from './telegram.service';
import { TelegramDispatcher } from './telegram.dispatcher';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { MenuHandler } from './handlers/menu.handler';
import { ExpenseHandler } from './handlers/expense.handler';
import { ReceiptHandler } from './handlers/receipt.handler';
import { QueryHandler } from './handlers/query.handler';
import { StepMessenger } from './step-messenger.service';
import { ConversationModule } from '../conversation/conversation.module';
import { AiModule } from '../ai/ai.module';
import { GoogleModule } from '../google/google.module';
import { PhoneLinkModule } from '../whatsapp/phone-link.module';
import { MESSAGING_PORT } from '../shared/messaging/messaging-port.interface';

@Module({
  imports: [ConfigModule, ConversationModule, AiModule, GoogleModule, PhoneLinkModule],
  controllers: [TelegramWebhookController],
  providers: [
    BotProvider,
    TelegramAdapter,
    { provide: MESSAGING_PORT, useExisting: TelegramAdapter },
    TelegramService,
    TelegramDispatcher,
    StepMessenger,
    MenuHandler,
    ExpenseHandler,
    ReceiptHandler,
    QueryHandler,
  ],
})
export class TelegramModule {}
```

- [ ] **Step 3: Update WhatsAppModule to import PhoneLinkModule instead of TelegramModule**

Replace `src/whatsapp/whatsapp.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsAppAdapter } from './whatsapp.adapter';
import { WhatsAppDispatcher } from './whatsapp.dispatcher';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { PhoneLinkModule } from './phone-link.module';
import { ConversationModule } from '../conversation/conversation.module';
import { AiModule } from '../ai/ai.module';
import { GoogleModule } from '../google/google.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MenuHandler } from '../telegram/handlers/menu.handler';
import { ExpenseHandler } from '../telegram/handlers/expense.handler';
import { ReceiptHandler } from '../telegram/handlers/receipt.handler';
import { QueryHandler } from '../telegram/handlers/query.handler';
import { StepMessenger } from '../telegram/step-messenger.service';
import { TelegramDispatcher } from '../telegram/telegram.dispatcher';
import { MESSAGING_PORT } from '../shared/messaging/messaging-port.interface';

@Module({
  imports: [ConfigModule, ConversationModule, AiModule, GoogleModule, PhoneLinkModule, TelegramModule],
  controllers: [WhatsAppWebhookController],
  providers: [
    WhatsAppAdapter,
    { provide: MESSAGING_PORT, useExisting: WhatsAppAdapter },
    WhatsAppDispatcher,
    StepMessenger,
    MenuHandler,
    ExpenseHandler,
    ReceiptHandler,
    QueryHandler,
    TelegramDispatcher,
  ],
})
export class WhatsAppModule {}
```

Wait — `WhatsAppModule` still imports `TelegramModule` (for `TelegramDispatcher` which is now provided locally). This creates a NestJS circular module issue since `TelegramModule` imports `PhoneLinkModule` from `src/whatsapp/`.

Actual fix: **do not** import `TelegramModule` in `WhatsAppModule`. Instead, provide `TelegramDispatcher` locally with its dependencies, which are already imported (AiModule, ConversationModule, etc.).

Updated `src/whatsapp/whatsapp.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsAppAdapter } from './whatsapp.adapter';
import { WhatsAppDispatcher } from './whatsapp.dispatcher';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { PhoneLinkModule } from './phone-link.module';
import { ConversationModule } from '../conversation/conversation.module';
import { AiModule } from '../ai/ai.module';
import { GoogleModule } from '../google/google.module';
import { MenuHandler } from '../telegram/handlers/menu.handler';
import { ExpenseHandler } from '../telegram/handlers/expense.handler';
import { ReceiptHandler } from '../telegram/handlers/receipt.handler';
import { QueryHandler } from '../telegram/handlers/query.handler';
import { StepMessenger } from '../telegram/step-messenger.service';
import { TelegramDispatcher } from '../telegram/telegram.dispatcher';
import { MESSAGING_PORT } from '../shared/messaging/messaging-port.interface';

@Module({
  imports: [ConfigModule, ConversationModule, AiModule, GoogleModule, PhoneLinkModule],
  controllers: [WhatsAppWebhookController],
  providers: [
    WhatsAppAdapter,
    { provide: MESSAGING_PORT, useExisting: WhatsAppAdapter },
    WhatsAppDispatcher,
    StepMessenger,
    MenuHandler,
    ExpenseHandler,
    ReceiptHandler,
    QueryHandler,
    TelegramDispatcher,
  ],
})
export class WhatsAppModule {}
```

- [ ] **Step 4: Full compile check**

```bash
pnpm exec tsc --noEmit 2>&1 | grep -v "node_modules"
```

Expected: 0 errors.

- [ ] **Step 5: Run all tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/whatsapp/phone-link.module.ts src/telegram/telegram.module.ts src/whatsapp/whatsapp.module.ts
git commit -m "fix: resolve circular dependency via PhoneLinkModule"
```

---

## Task 17: Final verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass, no regressions.

- [ ] **Step 2: Run TypeScript check**

```bash
pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: no errors (fix any formatting issues automatically since lint runs `--fix`).

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: `dist/` compiled successfully.

- [ ] **Step 5: Commit any lint fixes and close the feature**

```bash
git add -A
git commit -m "chore: lint fixes post-whatsapp-integration"
```

---

## Summary

| Task | Scope | Key Output |
|------|-------|------------|
| 1 | Install twilio | dependency added |
| 2 | MessagingPort interface | `MESSAGING_PORT` token, types |
| 3 | ConversationService migration | string chatIds throughout |
| 4 | TelegramAdapter | implements MessagingPort |
| 5 | StepMessenger refactor | uses MessagingPort |
| 6–9 | Handler refactors (×4) | chatId: string, MessagingPort |
| 10 | TelegramDispatcher refactor | string IDs, /vincular support |
| 11 | PhoneLinkService + TelegramModule wiring | phone linking, DI ready |
| 12 | WhatsAppAdapter | Twilio, interactive lists, media |
| 13 | WhatsAppDispatcher | routes Twilio payloads |
| 14 | Controller + Module | POST /whatsapp/webhook |
| 15 | AppModule + config | Twilio env vars |
| 16 | Circular dependency fix | PhoneLinkModule |
| 17 | Final verification | clean build + tests |
