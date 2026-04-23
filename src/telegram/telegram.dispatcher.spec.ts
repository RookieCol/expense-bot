jest.mock('langfuse', () => ({ Langfuse: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { TelegramDispatcher } from './telegram.dispatcher';
import { MenuHandler } from './handlers/menu.handler';
import { ExpenseHandler } from './handlers/expense.handler';
import { ReceiptHandler } from './handlers/receipt.handler';
import { QueryHandler } from './handlers/query.handler';
import { InsightsHandler } from './handlers/insights.handler';
import { ConversationService } from '../conversation/conversation.service';
import { AiService } from '../ai/ai.service';
import { I18nService } from '../i18n/i18n.service';
import { PhoneLinkService } from '../whatsapp/phone-link.service';
import { MESSAGING_PORT } from '../shared/messaging/messaging-port.interface';

describe('TelegramDispatcher.routeCallbackData', () => {
  let dispatcher: TelegramDispatcher;
  const menu = {
    showExpenseMethodMenu: jest.fn(),
    showMenu: jest.fn(),
    handleCancel: jest.fn(),
    startReceiptFlow: jest.fn(),
    startDictateFlow: jest.fn(),
    startExpenseFlow: jest.fn(),
  };
  const expense = {
    handleConfirmSave: jest.fn(),
    handleCategorySelected: jest.fn(),
    handleDescriptionSelected: jest.fn(),
    showEditMenu: jest.fn(),
    handleEditField: jest.fn(),
  };
  const query = {
    handleRecentExpenses: jest.fn(),
    handleMonthlySummary: jest.fn(),
  };
  const insights = {
    start: jest.fn(),
    handleQuestion: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramDispatcher,
        { provide: MESSAGING_PORT, useValue: { sendText: jest.fn() } },
        { provide: ConversationService, useValue: {} },
        { provide: AiService, useValue: {} },
        { provide: I18nService, useValue: new I18nService() },
        { provide: MenuHandler, useValue: menu },
        { provide: ExpenseHandler, useValue: expense },
        { provide: ReceiptHandler, useValue: {} },
        { provide: QueryHandler, useValue: query },
        { provide: InsightsHandler, useValue: insights },
        { provide: PhoneLinkService, useValue: {} },
      ],
    }).compile();
    dispatcher = module.get(TelegramDispatcher);
    jest.clearAllMocks();
  });

  it.each([
    ['cmd_gasto', () => menu.showExpenseMethodMenu],
    ['cmd_gastos', () => query.handleRecentExpenses],
    ['cmd_mes', () => query.handleMonthlySummary],
    ['back_menu', () => menu.showMenu],
    ['confirm_yes', () => expense.handleConfirmSave],
    ['confirm_no', () => menu.handleCancel],
    ['method_receipt', () => menu.startReceiptFlow],
    ['method_dictate', () => menu.startDictateFlow],
    ['method_manual', () => menu.startExpenseFlow],
    ['edit_menu', () => expense.showEditMenu],
    ['cmd_insights', () => insights.start],
  ])(
    'routes "%s" to the expected handler with the chatId',
    async (data, fn) => {
      await dispatcher.routeCallbackData('42', data);
      expect(fn()).toHaveBeenCalledWith('42');
    },
  );

  it('routes "cat_<value>" to handleCategorySelected with the stripped value', async () => {
    await dispatcher.routeCallbackData('42', 'cat_Cleaning');
    expect(expense.handleCategorySelected).toHaveBeenCalledWith(
      '42',
      'Cleaning',
    );
  });

  it('routes "desc_<value>" to handleDescriptionSelected with the stripped value', async () => {
    await dispatcher.routeCallbackData('42', 'desc_custom');
    expect(expense.handleDescriptionSelected).toHaveBeenCalledWith(
      '42',
      'custom',
    );
  });

  it('routes "edit_<field>" (non-menu) to handleEditField, not showEditMenu', async () => {
    await dispatcher.routeCallbackData('42', 'edit_amount');
    expect(expense.handleEditField).toHaveBeenCalledWith('42', 'amount');
    expect(expense.showEditMenu).not.toHaveBeenCalled();
  });

  it('matches "edit_menu" exactly before the edit_ prefix check (regression guard)', async () => {
    // 'edit_menu'.startsWith('edit_') is true; the dispatcher must NOT
    // call handleEditField with 'menu' — only showEditMenu.
    await dispatcher.routeCallbackData('42', 'edit_menu');
    expect(expense.showEditMenu).toHaveBeenCalledWith('42');
    expect(expense.handleEditField).not.toHaveBeenCalled();
  });

  it('does nothing (just logs) for an unknown callback payload', async () => {
    await dispatcher.routeCallbackData('42', 'totally_unknown');
    Object.values(menu).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    Object.values(expense).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    Object.values(query).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });
});

describe('TelegramDispatcher.dispatchTextInput (MANUAL_EXPENSE intent)', () => {
  let dispatcher: TelegramDispatcher;
  const menu = {
    showMenu: jest.fn(),
    handleCancel: jest.fn(),
    handleUnknown: jest.fn(),
    startExpenseFlow: jest.fn(),
    showExpenseMethodMenu: jest.fn(),
    startReceiptFlow: jest.fn(),
    startDictateFlow: jest.fn(),
  };
  const expense = {
    showConfirmation: jest.fn(),
    handleText: jest.fn(),
    handleConfirmSave: jest.fn(),
    handleCategorySelected: jest.fn(),
    handleDescriptionSelected: jest.fn(),
    showEditMenu: jest.fn(),
    handleEditField: jest.fn(),
  };
  const ai = {
    classifyIntent: jest.fn().mockResolvedValue('MANUAL_EXPENSE'),
    extractFromText: jest.fn(),
  };
  const conversation = {
    getContext: jest.fn(() => ({ state: 'IDLE' })),
    reset: jest.fn(),
    updatePending: jest.fn(),
    setState: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramDispatcher,
        { provide: MESSAGING_PORT, useValue: { sendText: jest.fn() } },
        { provide: ConversationService, useValue: conversation },
        { provide: AiService, useValue: ai },
        { provide: I18nService, useValue: new I18nService() },
        { provide: MenuHandler, useValue: menu },
        { provide: ExpenseHandler, useValue: expense },
        { provide: ReceiptHandler, useValue: {} },
        {
          provide: QueryHandler,
          useValue: { handleRecentExpenses: jest.fn() },
        },
        {
          provide: InsightsHandler,
          useValue: { start: jest.fn(), handleQuestion: jest.fn() },
        },
        { provide: PhoneLinkService, useValue: {} },
      ],
    }).compile();
    dispatcher = module.get(TelegramDispatcher);
    jest.clearAllMocks();
    ai.classifyIntent.mockResolvedValue('MANUAL_EXPENSE');
    conversation.getContext.mockReturnValue({ state: 'IDLE' });
  });

  const invoke = (text: string) =>
    (
      dispatcher as unknown as {
        dispatchTextInput: (c: string, t: string) => Promise<void>;
      }
    ).dispatchTextInput('42', text);

  it('jumps to confirmation when extraction yields an amount', async () => {
    ai.extractFromText.mockResolvedValueOnce({
      monto: 200000,
      proveedor: '',
      categoria: 'Administration',
      descripcion: 'transporte',
      fecha: '',
    });

    await invoke('registrar gasto de 200 mil en transporte');

    expect(conversation.updatePending).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ monto: 200000, descripcion: 'transporte' }),
    );
    expect(expense.showConfirmation).toHaveBeenCalledWith('42');
    expect(menu.startExpenseFlow).not.toHaveBeenCalled();
  });

  it("fills in today's date when extraction produced none", async () => {
    ai.extractFromText.mockResolvedValueOnce({ monto: 50, fecha: '' });
    await invoke('gasté 50 en algo');
    const [, data] = conversation.updatePending.mock.calls[0] as [
      string,
      { fecha: string },
    ];
    expect(data.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('falls back to the step-by-step flow when extraction has no amount', async () => {
    ai.extractFromText.mockResolvedValueOnce({ monto: 0, proveedor: '' });
    await invoke('quiero registrar un gasto');
    expect(menu.startExpenseFlow).toHaveBeenCalledWith('42');
    expect(expense.showConfirmation).not.toHaveBeenCalled();
  });

  it('falls back to the step-by-step flow when extraction throws', async () => {
    ai.extractFromText.mockRejectedValueOnce(new Error('AI down'));
    await invoke('registrar gasto');
    expect(menu.startExpenseFlow).toHaveBeenCalledWith('42');
  });
});
