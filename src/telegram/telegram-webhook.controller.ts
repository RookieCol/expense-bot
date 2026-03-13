import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from './telegram.service';
import { TELEGRAM_WEBHOOK_POST_SEGMENT } from './telegram.constants';

@Controller('telegram')
export class TelegramWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly telegram: TelegramService,
  ) {}

  @Post(TELEGRAM_WEBHOOK_POST_SEGMENT)
  @HttpCode(200)
  handleWebhook(
    @Body() update: TelegramBot.Update,
    @Headers('x-telegram-bot-api-secret-token') secretToken?: string,
  ): { ok: true } {
    const expectedSecret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    if (expectedSecret && secretToken !== expectedSecret) {
      throw new UnauthorizedException('Invalid Telegram webhook secret token');
    }

    this.telegram.handleWebhookUpdate(update);
    return { ok: true };
  }
}
