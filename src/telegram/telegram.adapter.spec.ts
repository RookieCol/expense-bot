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
