import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WhatsAppAdapter } from './whatsapp.adapter';
import { ConversationService } from '../conversation/conversation.service';
import { WhatsAppTemplateService } from './whatsapp-template.service';

const mockCreate = jest.fn();

jest.mock('twilio', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

describe('WhatsAppAdapter', () => {
  let adapter: WhatsAppAdapter;
  let conversation: { setPendingMenuOptions: jest.Mock };

  beforeEach(async () => {
    mockCreate.mockResolvedValue({ sid: 'SM123' });
    conversation = { setPendingMenuOptions: jest.fn() };
    const templates = { getSid: jest.fn().mockReturnValue(undefined) };
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
        { provide: ConversationService, useValue: conversation },
        { provide: WhatsAppTemplateService, useValue: templates },
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

  it('sendMenu sends numbered text and stores option ids', async () => {
    await adapter.sendMenu('+57300', 'Pick one:', [
      {
        title: '',
        options: [
          { id: 'opt_a', label: 'Option A' },
          { id: 'opt_b', label: 'Option B' },
        ],
      },
    ]);
    const call = mockCreate.mock.calls[0][0];
    expect(call.from).toBe('whatsapp:+14155238886');
    expect(call.to).toBe('whatsapp:+57300');
    expect(call.body).toContain('1. Option A');
    expect(call.body).toContain('2. Option B');
    expect(conversation.setPendingMenuOptions).toHaveBeenCalledWith('+57300', [
      'opt_a',
      'opt_b',
    ]);
  });
});
