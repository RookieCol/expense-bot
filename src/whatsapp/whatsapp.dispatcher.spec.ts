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
const mockExpense = { showConfirmation: jest.fn(), handleText: jest.fn() };
const mockReceipt = { handlePhotoBuffer: jest.fn() };
const mockQuery = { handleRecentExpenses: jest.fn(), handleMonthlySummary: jest.fn() };
const mockDispatcher = { routeCallbackData: jest.fn(), dispatchVoice: jest.fn() };
const mockConversation = { setUserName: jest.fn(), addUserMessageId: jest.fn(), getContext: jest.fn(() => ({ state: 'IDLE' })) };
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
    mockConversation.getContext.mockReturnValue({ state: 'IDLE' });
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
