import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { BOT } from './bot.provider';
import { TelegramDispatcher } from './telegram.dispatcher';
import { TELEGRAM_WEBHOOK_PATH } from './telegram.constants';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @Inject(BOT) private readonly bot: TelegramBot,
    private readonly config: ConfigService,
    private readonly dispatcher: TelegramDispatcher,
  ) {}

  async onModuleInit() {
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
      this.dispatcher
        .dispatchCallback(query)
        .catch((err) => this.logger.error('Callback dispatch error', err));
    });

    const transport = this.config.get<'polling' | 'webhook'>(
      'TELEGRAM_TRANSPORT',
      'polling',
    );

    if (transport === 'webhook') {
      const webhookUrl = this.config.get<string>('TELEGRAM_WEBHOOK_URL');
      if (!webhookUrl) {
        this.logger.error(
          'TELEGRAM_TRANSPORT=webhook requires TELEGRAM_WEBHOOK_URL',
        );
        throw new Error('Missing TELEGRAM_WEBHOOK_URL');
      }
      this.validateWebhookUrl(webhookUrl);

      const webhookSecret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
      await this.bot.setWebHook(webhookUrl, {
        secret_token: webhookSecret || undefined,
      });
      this.logger.log(`Telegram bot started (webhook: ${webhookUrl})`);
      return;
    }

    await this.bot.deleteWebHook().catch(() => {
      this.logger.warn('Could not delete webhook before polling startup');
    });
    await this.bot.startPolling();
    this.logger.log('Telegram bot started (polling)');
  }

  handleWebhookUpdate(update: TelegramBot.Update): void {
    this.bot.processUpdate(update);
  }

  private validateWebhookUrl(webhookUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      throw new Error('Invalid TELEGRAM_WEBHOOK_URL');
    }

    if (parsed.protocol !== 'https:') {
      throw new Error('TELEGRAM_WEBHOOK_URL must use https://');
    }

    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    if (pathname !== TELEGRAM_WEBHOOK_PATH) {
      throw new Error(
        `TELEGRAM_WEBHOOK_URL path must be ${TELEGRAM_WEBHOOK_PATH}`,
      );
    }
  }
}
