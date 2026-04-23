jest.mock('@langfuse/tracing', () => ({
  propagateAttributes: (_attrs: unknown, fn: () => unknown) => fn(),
  startActiveObservation: (
    _name: string,
    fn: (span: { update: jest.Mock }) => unknown,
  ) => fn({ update: jest.fn() }),
}));

const mockValidateRequest = jest.fn();
jest.mock('twilio', () => ({
  validateRequest: mockValidateRequest,
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppDispatcher } from './whatsapp.dispatcher';

const buildController = async (config: {
  authToken?: string;
  webhookUrl?: string;
}) => {
  const dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'TWILIO_AUTH_TOKEN') return config.authToken;
      if (key === 'WHATSAPP_WEBHOOK_URL') return config.webhookUrl;
      return undefined;
    }),
  };
  const module: TestingModule = await Test.createTestingModule({
    controllers: [WhatsAppWebhookController],
    providers: [
      { provide: ConfigService, useValue: configService },
      { provide: WhatsAppDispatcher, useValue: dispatcher },
    ],
  }).compile();
  return {
    controller: module.get(WhatsAppWebhookController),
    dispatcher,
  };
};

const payload = {
  From: 'whatsapp:+573001234567',
  Body: 'hola',
  NumMedia: '0',
};

describe('WhatsAppWebhookController', () => {
  beforeEach(() => {
    mockValidateRequest.mockReset();
  });

  it('returns TwiML empty response and dispatches async', async () => {
    const { controller, dispatcher } = await buildController({
      authToken: 'tok',
      webhookUrl: 'https://example.com/whatsapp/webhook',
    });
    mockValidateRequest.mockReturnValue(true);

    const result = controller.handleWebhook(payload, 'sig-ok');

    expect(result).toBe('<Response></Response>');
    expect(dispatcher.dispatch).toHaveBeenCalledWith(payload);
  });

  it('validates the Twilio signature when both webhookUrl and signature are present', async () => {
    const { controller } = await buildController({
      authToken: 'tok',
      webhookUrl: 'https://example.com/whatsapp/webhook',
    });
    mockValidateRequest.mockReturnValue(true);

    controller.handleWebhook(payload, 'sig-ok');

    expect(mockValidateRequest).toHaveBeenCalledWith(
      'tok',
      'sig-ok',
      'https://example.com/whatsapp/webhook',
      payload,
    );
  });

  it('rejects with UnauthorizedException when the signature is invalid', async () => {
    const { controller, dispatcher } = await buildController({
      authToken: 'tok',
      webhookUrl: 'https://example.com/whatsapp/webhook',
    });
    mockValidateRequest.mockReturnValue(false);

    expect(() => controller.handleWebhook(payload, 'sig-bad')).toThrow(
      UnauthorizedException,
    );
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('skips validation when WHATSAPP_WEBHOOK_URL is not configured (e.g. local dev)', async () => {
    const { controller, dispatcher } = await buildController({
      authToken: 'tok',
      webhookUrl: undefined,
    });

    controller.handleWebhook(payload, 'any-sig');

    expect(mockValidateRequest).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(payload);
  });

  it('skips validation when the signature header is missing', async () => {
    const { controller, dispatcher } = await buildController({
      authToken: 'tok',
      webhookUrl: 'https://example.com/whatsapp/webhook',
    });

    controller.handleWebhook(payload, undefined);

    expect(mockValidateRequest).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(payload);
  });
});
