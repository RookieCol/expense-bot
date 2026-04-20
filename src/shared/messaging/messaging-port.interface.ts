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
