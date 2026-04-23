jest.mock('@langfuse/tracing', () => ({
  propagateAttributes: (_attrs: unknown, fn: () => unknown) => fn(),
  startActiveObservation: (
    _name: string,
    fn: (span: { update: jest.Mock }) => unknown,
  ) => fn({ update: jest.fn() }),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { InsightsHandler } from './insights.handler';
import { ConversationService } from '../../conversation/conversation.service';
import { ConversationState } from '../../conversation/conversation-state.enum';
import { I18nService } from '../../i18n/i18n.service';
import { ExpensesQueryAgent } from '../../ai/agents/expenses-query.agent';
import { MESSAGING_PORT } from '../../shared/messaging/messaging-port.interface';

const buildHandler = async (overrides: { ask?: jest.Mock }) => {
  const messaging = {
    sendText: jest
      .fn()
      .mockResolvedValueOnce({ messageId: 'thinking-1' })
      .mockResolvedValue({ messageId: 'reply-1' }),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
  };
  const conversation = {
    reset: jest.fn(),
    setState: jest.fn(),
    addManualStepId: jest.fn(),
    setLastBotMessageId: jest.fn(),
  };
  const agent = { ask: overrides.ask ?? jest.fn() };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      InsightsHandler,
      { provide: MESSAGING_PORT, useValue: messaging },
      { provide: ConversationService, useValue: conversation },
      { provide: I18nService, useValue: new I18nService() },
      { provide: ExpensesQueryAgent, useValue: agent },
    ],
  }).compile();
  return {
    handler: module.get(InsightsHandler),
    messaging,
    conversation,
    agent,
  };
};

describe('InsightsHandler', () => {
  describe('start', () => {
    it('resets state, enters WAITING_QUESTION and sends the ask prompt', async () => {
      const { handler, conversation, messaging } = await buildHandler({});

      await handler.start('42');

      expect(conversation.reset).toHaveBeenCalledWith('42');
      expect(conversation.setState).toHaveBeenCalledWith(
        '42',
        ConversationState.WAITING_QUESTION,
      );
      expect(messaging.sendText).toHaveBeenCalledTimes(1);
      expect(conversation.addManualStepId).toHaveBeenCalledWith(
        '42',
        'thinking-1',
      );
    });
  });

  describe('handleQuestion', () => {
    it('on success: deletes the spinner, sends the agent answer, resets state', async () => {
      const ask = jest.fn().mockResolvedValue('Gastaste $80.000 en limpieza.');
      const { handler, messaging, conversation } = await buildHandler({
        ask,
      });

      await handler.handleQuestion('42', '¿cuánto gasté en limpieza?');

      expect(ask).toHaveBeenCalledWith('¿cuánto gasté en limpieza?', '42');
      // spinner was deleted
      expect(messaging.deleteMessage).toHaveBeenCalledWith('42', 'thinking-1');
      // answer sent as plain text (no markdown parseMode → safe against
      // whatever punctuation the LLM returns)
      expect(messaging.sendText).toHaveBeenNthCalledWith(
        2,
        '42',
        'Gastaste $80.000 en limpieza.',
      );
      expect(conversation.reset).toHaveBeenCalledWith('42');
      expect(conversation.setLastBotMessageId).toHaveBeenCalledWith(
        '42',
        'reply-1',
      );
    });

    it('on error: deletes the spinner, resets state, shows insights.error', async () => {
      const ask = jest.fn().mockRejectedValue(new Error('model down'));
      const { handler, messaging, conversation } = await buildHandler({
        ask,
      });

      await handler.handleQuestion('42', 'hola');

      expect(messaging.deleteMessage).toHaveBeenCalledWith('42', 'thinking-1');
      expect(conversation.reset).toHaveBeenCalledWith('42');
      // second sendText is the error message (markdown-parsed)
      expect(messaging.sendText).toHaveBeenCalledTimes(2);
      expect(messaging.sendText.mock.calls[1][2]).toEqual({
        parseMode: 'MarkdownV2',
      });
    });
  });
});
