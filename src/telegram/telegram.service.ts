import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
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
    this.bot.on('message', (msg) => {
      this.dispatcher.dispatchMessage(msg).catch((err) =>
        this.logger.error('Dispatch error', err),
      );
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
