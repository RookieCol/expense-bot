import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { BOT } from './bot.provider';
import { TelegramDispatcher } from './telegram.dispatcher';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly dispatcher: TelegramDispatcher,
  ) {}

  onModuleInit() {
    this.bot.on('message', async (msg) => {
      try {
        if (msg.voice) {
          const fileLink = await this.bot.getFileLink(msg.voice.file_id);
          const res = await axios.get<ArrayBuffer>(fileLink, {
            responseType: 'arraybuffer',
          });
          const buffer = Buffer.from(res.data);
          return await this.dispatcher.dispatchVoice(msg.chat.id, buffer);
        }
        await this.dispatcher.dispatchMessage(msg);
      } catch (err) {
        this.logger.error('Message dispatch error', err);
      }
    });

    this.bot.on('callback_query', async (query) => {
      await this.bot.answerCallbackQuery(query.id).catch(() => null);
      this.dispatcher.dispatchCallback(query).catch((err) =>
        this.logger.error('Callback dispatch error', err),
      );
    });

    this.bot.startPolling();
    this.logger.log('Telegram bot started (polling)');
  }
}
