import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Twilio from 'twilio';
import { WhatsAppDispatcher } from './whatsapp.dispatcher';
import type { TwilioWebhookPayload } from './whatsapp.dispatcher';

@Controller('whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dispatcher: WhatsAppDispatcher,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  handleWebhook(
    @Body() payload: TwilioWebhookPayload,
    @Headers('x-twilio-signature') twilioSignature?: string,
  ): string {
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN') ?? '';
    const webhookUrl = this.config.get<string>('WHATSAPP_WEBHOOK_URL') ?? '';

    if (webhookUrl && twilioSignature) {
      const isValid = Twilio.validateRequest(
        authToken,
        twilioSignature,
        webhookUrl,
        payload as unknown as Record<string, string>,
      );
      if (!isValid) {
        throw new UnauthorizedException('Invalid Twilio signature');
      }
    }

    // Process async — respond immediately
    this.dispatcher
      .dispatch(payload)
      .catch((err) => this.logger.error('WhatsApp dispatch error', err));

    // Twilio expects empty TwiML or plain 200 response
    return '<Response></Response>';
  }
}
