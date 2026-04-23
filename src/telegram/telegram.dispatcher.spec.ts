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
