import { Injectable, Inject } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { BOT } from './bot.provider';
import { ConversationService } from '../conversation/conversation.service';

/**
 * Sends a step message, automatically deleting the previous step message first.
 * Use this for all "flow" messages so only the current step is visible.
 */
@Injectable()
export class StepMessenger {
  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly conversation: ConversationService,
  ) {}

  async send(
    chatId: number,
    text: string,
    opts?: TelegramBot.SendMessageOptions,
  ): Promise<TelegramBot.Message> {
    const ctx = this.conversation.getContext(chatId);
    if (ctx.lastBotMessageId) {
      await this.bot
        .deleteMessage(chatId, ctx.lastBotMessageId)
        .catch(() => {});
    }
    const msg = await this.bot.sendMessage(chatId, text, opts);
    this.conversation.setLastBotMessageId(chatId, msg.message_id);
    return msg;
  }
}
