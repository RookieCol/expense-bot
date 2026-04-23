jest.mock('@langfuse/tracing', () => ({
  propagateAttributes: (_attrs: unknown, fn: () => unknown) => fn(),
  startActiveObservation: (
    _name: string,
    fn: (span: { update: jest.Mock }) => unknown,
  ) => fn({ update: jest.fn() }),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type TelegramBot from 'node-telegram-bot-api';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramService } from './telegram.service';

const buildController = async (secret: string | undefined) => {
  const telegram = { handleWebhookUpdate: jest.fn() };
  const config = {
    get: jest.fn((key: string) =>
      key === 'TELEGRAM_WEBHOOK_SECRET' ? secret : undefined,
    ),
  };
  const module: TestingModule = await Test.createTestingModule({
    controllers: [TelegramWebhookController],
    providers: [
      { provide: ConfigService, useValue: config },
      { provide: TelegramService, useValue: telegram },
    ],
  }).compile();
  return {
    controller: module.get(TelegramWebhookController),
    telegram,
  };
};

const update = {} as TelegramBot.Update;

describe('TelegramWebhookController', () => {
  describe('GET / and HEAD /', () => {
    it('returns { ok: true } for health check probes', async () => {
      const { controller } = await buildController(undefined);
      expect(controller.root()).toEqual({ ok: true });
      expect(controller.health()).toEqual({ ok: true });
    });
  });

  describe('POST /telegram/webhook', () => {
    it('accepts the update when no secret is configured (secret optional)', async () => {
      const { controller, telegram } = await buildController(undefined);
      expect(controller.handleWebhook(update)).toEqual({ ok: true });
      expect(telegram.handleWebhookUpdate).toHaveBeenCalledWith(update);
    });

    it('accepts the update when the secret matches', async () => {
      const { controller, telegram } = await buildController('shh');
      expect(controller.handleWebhook(update, 'shh')).toEqual({ ok: true });
      expect(telegram.handleWebhookUpdate).toHaveBeenCalledWith(update);
    });

    it('rejects with UnauthorizedException when the secret does not match', async () => {
      const { controller, telegram } = await buildController('shh');
      expect(() => controller.handleWebhook(update, 'wrong')).toThrow(
        UnauthorizedException,
      );
      expect(telegram.handleWebhookUpdate).not.toHaveBeenCalled();
    });

    it('rejects when a secret is required but the header is missing', async () => {
      const { controller, telegram } = await buildController('shh');
      expect(() => controller.handleWebhook(update)).toThrow(
        UnauthorizedException,
      );
      expect(telegram.handleWebhookUpdate).not.toHaveBeenCalled();
    });
  });
});
