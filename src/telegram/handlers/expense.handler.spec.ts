import { Test, TestingModule } from '@nestjs/testing';
import { ExpenseHandler } from './expense.handler';
import { MenuHandler } from './menu.handler';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { SheetsService } from '../../google/sheets.service';
import { DriveService } from '../../google/drive.service';
import { I18nService } from '../../i18n/i18n.service';
import { StepMessenger } from '../step-messenger.service';
import { MESSAGING_PORT } from '../../shared/messaging/messaging-port.interface';

type Ctx = ReturnType<ConversationService['getContext']>;

const freshCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
  state: ConversationState.IDLE,
  pendingExpense: {},
  manualStepIds: [],
  userMessageIds: [],
  ...overrides,
});

const makeMocks = (ctx: Ctx) => {
  const messaging = {
    sendText: jest.fn().mockResolvedValue({ messageId: 'bot-msg-1' }),
    sendMenu: jest.fn().mockResolvedValue({ messageId: 'menu-1' }),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
    editText: jest.fn().mockResolvedValue({ messageId: 'edit-1' }),
    sendPhoto: jest.fn().mockResolvedValue({ messageId: 'photo-1' }),
  };
  const conversation = {
    getContext: jest.fn(() => ctx),
    setState: jest.fn((_id: string, s: ConversationState) => {
      ctx.state = s;
    }),
    updatePending: jest.fn(
      (_id: string, data: Partial<Ctx['pendingExpense']>) => {
        ctx.pendingExpense = { ...ctx.pendingExpense, ...data };
      },
    ),
    addManualStepId: jest.fn((_id: string, msgId: string) => {
      ctx.manualStepIds.push(msgId);
    }),
    addUserMessageId: jest.fn(),
    setEditingField: jest.fn((_id: string, field: string) => {
      ctx.editingField = field;
    }),
    setEditStepMessageId: jest.fn((_id: string, msgId: string | undefined) => {
      ctx.editStepMessageId = msgId;
    }),
    setLastBotMessageId: jest.fn((_id: string, msgId: string) => {
      ctx.lastBotMessageId = msgId;
    }),
    setUserName: jest.fn(),
    reset: jest.fn(),
    setImageBuffer: jest.fn(),
    clearPendingMenuOptions: jest.fn(),
    getPendingMenuOptions: jest.fn(),
    setPendingMenuOptions: jest.fn(),
  };
  const sheets = { appendExpense: jest.fn().mockResolvedValue(undefined) };
  const drive = { uploadImage: jest.fn().mockResolvedValue('drive-link') };
  const menuHandler = { handleCancel: jest.fn() };
  const step = {
    send: jest.fn().mockResolvedValue({ messageId: 'step-1' }),
  };
  return { messaging, conversation, sheets, drive, menuHandler, step };
};

const buildHandler = async (ctx: Ctx) => {
  const mocks = makeMocks(ctx);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ExpenseHandler,
      { provide: MESSAGING_PORT, useValue: mocks.messaging },
      { provide: ConversationService, useValue: mocks.conversation },
      { provide: SheetsService, useValue: mocks.sheets },
      { provide: DriveService, useValue: mocks.drive },
      { provide: I18nService, useValue: new I18nService() },
      { provide: MenuHandler, useValue: mocks.menuHandler },
      { provide: StepMessenger, useValue: mocks.step },
    ],
  }).compile();
  return { handler: module.get(ExpenseHandler), mocks };
};

describe('ExpenseHandler', () => {
  describe('handleText — WAITING_AMOUNT', () => {
    it('parses a valid amount, advances to WAITING_PROVIDER, and tracks the bot message', async () => {
      const ctx = freshCtx({ state: ConversationState.WAITING_AMOUNT });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleText('123', '50');

      expect(mocks.conversation.updatePending).toHaveBeenCalledWith('123', {
        amount: 50,
      });
      expect(ctx.state).toBe(ConversationState.WAITING_PROVIDER);
      expect(mocks.messaging.sendText).toHaveBeenCalledTimes(1);
      expect(mocks.conversation.addManualStepId).toHaveBeenCalledWith(
        '123',
        'bot-msg-1',
      );
    });

    it('accepts comma as decimal separator', async () => {
      const ctx = freshCtx({ state: ConversationState.WAITING_AMOUNT });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleText('123', '123,75');

      expect(mocks.conversation.updatePending).toHaveBeenCalledWith('123', {
        amount: 123.75,
      });
    });

    it('rejects non-numeric input without advancing state', async () => {
      const ctx = freshCtx({ state: ConversationState.WAITING_AMOUNT });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleText('123', 'abc');

      expect(mocks.conversation.updatePending).not.toHaveBeenCalled();
      expect(ctx.state).toBe(ConversationState.WAITING_AMOUNT);
      expect(mocks.messaging.sendText).toHaveBeenCalledTimes(1);
    });

    it('rejects zero and negative amounts', async () => {
      const ctx = freshCtx({ state: ConversationState.WAITING_AMOUNT });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleText('123', '0');
      expect(mocks.conversation.updatePending).not.toHaveBeenCalled();
      expect(ctx.state).toBe(ConversationState.WAITING_AMOUNT);

      await handler.handleText('123', '-5');
      expect(mocks.conversation.updatePending).not.toHaveBeenCalled();
    });
  });

  describe('handleText — WAITING_PROVIDER', () => {
    it('stores the provider text, advances to WAITING_CATEGORY, and sends the category menu', async () => {
      const ctx = freshCtx({ state: ConversationState.WAITING_PROVIDER });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleText('123', 'Ferrería El Tornillo');

      expect(mocks.conversation.updatePending).toHaveBeenCalledWith('123', {
        provider: 'Ferrería El Tornillo',
      });
      expect(ctx.state).toBe(ConversationState.WAITING_CATEGORY);
      expect(mocks.messaging.sendMenu).toHaveBeenCalledTimes(1);
      const [, , sections, menuType] = mocks.messaging.sendMenu.mock.calls[0];
      expect(menuType).toBe('CATEGORIA_MENU');
      expect(sections[0].options.length).toBe(5); // 4 categories + cancel
    });
  });

  describe('handleCategorySelected', () => {
    it('stores category and asks for reason (text prompt)', async () => {
      const ctx = freshCtx({
        state: ConversationState.WAITING_CATEGORY,
        pendingExpense: { amount: 50, provider: 'Mercado', date: '2026-04-20' },
      });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleCategorySelected('123', 'Compras');

      expect(mocks.conversation.updatePending).toHaveBeenCalledWith('123', {
        category: 'Compras',
      });
      expect(ctx.state).toBe(ConversationState.WAITING_REASON);
      expect(mocks.messaging.sendText).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleText — WAITING_REASON', () => {
    it('stores the reason and asks for payment method', async () => {
      const ctx = freshCtx({
        state: ConversationState.WAITING_REASON,
        pendingExpense: {
          amount: 50,
          provider: 'Mercado',
          category: 'Compras',
          date: '2026-04-20',
        },
      });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleText('123', 'Compras semanales');

      expect(mocks.conversation.updatePending).toHaveBeenCalledWith('123', {
        reason: 'Compras semanales',
      });
      expect(mocks.messaging.sendMenu).toHaveBeenCalledWith(
        '123',
        expect.any(String),
        expect.any(Array),
        'METODO_MENU',
      );
    });
  });

  describe('handleConfirmSave', () => {
    const fullExpense = {
      amount: 50,
      provider: 'Mercado',
      category: 'Compras',
      reason: 'Compras semanales',
      date: '2026-04-20',
    };

    it('refuses to save unless state is WAITING_CONFIRMATION', async () => {
      const ctx = freshCtx({
        state: ConversationState.WAITING_AMOUNT,
        pendingExpense: fullExpense,
      });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleConfirmSave('123');

      expect(mocks.sheets.appendExpense).not.toHaveBeenCalled();
    });

    it('persists to Sheets, sends the "saved" summary, and resets state', async () => {
      const ctx = freshCtx({
        state: ConversationState.WAITING_CONFIRMATION,
        pendingExpense: fullExpense,
        userName: '@alice',
        lastBotMessageId: 'prev-confirm',
      });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleConfirmSave('123');

      expect(mocks.messaging.deleteMessage).toHaveBeenCalledWith(
        '123',
        'prev-confirm',
      );
      expect(mocks.sheets.appendExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 50,
          by: '@alice',
          date: '2026-04-20',
        }),
      );
      expect(mocks.messaging.deleteMessage).toHaveBeenCalledWith(
        '123',
        'bot-msg-1',
      );
      expect(mocks.conversation.reset).toHaveBeenCalled();
    });

    it("fills in today's date when the pending expense has none", async () => {
      const ctx = freshCtx({
        state: ConversationState.WAITING_CONFIRMATION,
        pendingExpense: { ...fullExpense, date: undefined },
      });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleConfirmSave('123');

      const today = new Date().toISOString().split('T')[0];
      expect(mocks.sheets.appendExpense).toHaveBeenCalledWith(
        expect.objectContaining({ date: today }),
      );
    });

    it('sends a save_error message when Sheets fails', async () => {
      const ctx = freshCtx({
        state: ConversationState.WAITING_CONFIRMATION,
        pendingExpense: fullExpense,
      });
      const { handler, mocks } = await buildHandler(ctx);
      mocks.sheets.appendExpense.mockRejectedValueOnce(new Error('quota'));

      await handler.handleConfirmSave('123');

      expect(mocks.messaging.sendText).toHaveBeenCalledTimes(2);
    });
  });

  describe('showEditMenu', () => {
    it('sends the EDIT_MENU with all field options and tracks the message as editStep', async () => {
      const ctx = freshCtx({ state: ConversationState.WAITING_CONFIRMATION });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.showEditMenu('123');

      expect(mocks.messaging.sendMenu).toHaveBeenCalledWith(
        '123',
        expect.any(String),
        expect.any(Array),
        'EDIT_MENU',
      );
      const [, , sections] = mocks.messaging.sendMenu.mock.calls[0];
      const ids = sections[0].options.map((o: { id: string }) => o.id);
      expect(ids).toEqual([
        'edit_amount',
        'edit_provider',
        'edit_categoria',
        'edit_motivo',
        'edit_metodo',
      ]);
      expect(mocks.conversation.setEditStepMessageId).toHaveBeenCalledWith(
        '123',
        'menu-1',
      );
    });
  });

  describe('handleEditField', () => {
    it('for a text field: sets state EDITING_FIELD, records editingField, prompts and tracks', async () => {
      const ctx = freshCtx({
        state: ConversationState.WAITING_CONFIRMATION,
        editStepMessageId: 'edit-menu-1',
      });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleEditField('123', 'amount');

      expect(mocks.messaging.deleteMessage).toHaveBeenCalledWith(
        '123',
        'edit-menu-1',
      );
      expect(ctx.state).toBe(ConversationState.EDITING_FIELD);
      expect(mocks.conversation.setEditingField).toHaveBeenCalledWith(
        '123',
        'amount',
      );
      expect(mocks.messaging.sendText).toHaveBeenCalledTimes(1);
      expect(mocks.conversation.setEditStepMessageId).toHaveBeenCalledWith(
        '123',
        'bot-msg-1',
      );
    });

    it('for categoria: reopens the category menu as an overlay', async () => {
      const ctx = freshCtx({ state: ConversationState.WAITING_CONFIRMATION });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleEditField('123', 'categoria');

      expect(ctx.state).toBe(ConversationState.WAITING_CATEGORY);
      expect(mocks.messaging.sendMenu).toHaveBeenCalledWith(
        '123',
        expect.any(String),
        expect.any(Array),
        'CATEGORIA_MENU',
      );
      expect(mocks.conversation.setEditStepMessageId).toHaveBeenCalledWith(
        '123',
        'menu-1',
      );
      expect(mocks.conversation.addManualStepId).not.toHaveBeenCalled();
    });
  });

  describe('handleText — EDITING_FIELD', () => {
    const base = {
      amount: 50,
      provider: 'Mercado',
      category: 'Compras',
      reason: 'Compras semanales',
      date: '2026-04-20',
    };

    it('edits the amount and returns to WAITING_CONFIRMATION', async () => {
      const ctx = freshCtx({
        state: ConversationState.EDITING_FIELD,
        editingField: 'amount',
        pendingExpense: base,
      });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleText('123', '75,50');

      expect(mocks.conversation.updatePending).toHaveBeenCalledWith('123', {
        amount: 75.5,
      });
      expect(ctx.state).toBe(ConversationState.WAITING_CONFIRMATION);
      expect(mocks.step.send).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid amount during edit without advancing state', async () => {
      const ctx = freshCtx({
        state: ConversationState.EDITING_FIELD,
        editingField: 'amount',
        pendingExpense: base,
      });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleText('123', 'abc');

      expect(mocks.conversation.updatePending).not.toHaveBeenCalled();
      expect(ctx.state).toBe(ConversationState.EDITING_FIELD);
    });

    it('edits the provider and returns to WAITING_CONFIRMATION', async () => {
      const ctx = freshCtx({
        state: ConversationState.EDITING_FIELD,
        editingField: 'provider',
        pendingExpense: base,
      });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleText('123', 'New Store');

      expect(mocks.conversation.updatePending).toHaveBeenCalledWith('123', {
        provider: 'New Store',
      });
      expect(ctx.state).toBe(ConversationState.WAITING_CONFIRMATION);
    });

    it('edits the reason and returns to WAITING_CONFIRMATION', async () => {
      const ctx = freshCtx({
        state: ConversationState.EDITING_FIELD,
        editingField: 'motivo',
        pendingExpense: base,
      });
      const { handler, mocks } = await buildHandler(ctx);

      await handler.handleText('123', 'Materiales de construcción');

      expect(mocks.conversation.updatePending).toHaveBeenCalledWith('123', {
        reason: 'Materiales de construcción',
      });
      expect(ctx.state).toBe(ConversationState.WAITING_CONFIRMATION);
    });
  });
});
