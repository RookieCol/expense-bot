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

  async sendMenu(chatId: string, text: string, sections: MenuSection[], _menuType?: string): Promise<SentMessage> {
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
