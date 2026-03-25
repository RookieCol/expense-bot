import {
  Body,
  Controller,
  Get,
  Head,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from './telegram.service';

@Controller()
export class TelegramWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly telegram: TelegramService,
  ) {}

  /** Render port scanner hits GET / and HEAD / — respond 200 immediately */
  @Get()
  @Head()
  root(): { ok: true } {
    return { ok: true };
  }

  @Get('/health')
  health(): { ok: true } {
    return { ok: true };
  }

  @Post('/telegram/webhook')
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
