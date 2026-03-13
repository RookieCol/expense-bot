import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';

export const BOT = 'TELEGRAM_BOT';

export const BotProvider = {
  provide: BOT,
  useFactory: (config: ConfigService): TelegramBot =>
    new TelegramBot(config.get<string>('TELEGRAM_BOT_TOKEN')!, {
      polling: false,
    }),
  inject: [ConfigService],
};
