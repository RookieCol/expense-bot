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
