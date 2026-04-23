import { Test, TestingModule } from '@nestjs/testing';
import { StepMessenger } from './step-messenger.service';
import { ConversationService } from '../conversation/conversation.service';
import { MESSAGING_PORT } from '../shared/messaging/messaging-port.interface';

type Ctx = {
  lastBotMessageId?: string;
  editStepMessageId?: string;
  manualStepIds: string[];
  userMessageIds: string[];
};

const build = async (ctx: Ctx) => {
  const messaging = {
    sendText: jest.fn().mockResolvedValue({ messageId: 'new-1' }),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
  };
  const conversation = {
    getContext: jest.fn(() => ctx),
    setEditStepMessageId: jest.fn((_: string, id: string | undefined) => {
      ctx.editStepMessageId = id;
    }),
    setLastBotMessageId: jest.fn((_: string, id: string) => {
      ctx.lastBotMessageId = id;
    }),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      StepMessenger,
      { provide: MESSAGING_PORT, useValue: messaging },
      { provide: ConversationService, useValue: conversation },
    ],
  }).compile();
  return { step: module.get(StepMessenger), messaging, conversation };
};

describe('StepMessenger.send', () => {
  it('sends the new message and stores its id as lastBotMessageId', async () => {
    const ctx: Ctx = { manualStepIds: [], userMessageIds: [] };
    const { step, messaging, conversation } = await build(ctx);

    const result = await step.send('42', 'hello', { parseMode: 'MarkdownV2' });

    expect(messaging.sendText).toHaveBeenCalledWith('42', 'hello', {
      parseMode: 'MarkdownV2',
    });
    expect(result.messageId).toBe('new-1');
    expect(conversation.setLastBotMessageId).toHaveBeenCalledWith(
      '42',
      'new-1',
    );
  });

  it('deletes every prior tracked message (lastBot, editStep, manualSteps, userMessages)', async () => {
    const ctx: Ctx = {
      lastBotMessageId: 'bot-prev',
      editStepMessageId: 'edit-overlay',
      manualStepIds: ['step-a', 'step-b'],
      userMessageIds: ['user-a'],
    };
    const { step, messaging } = await build(ctx);

    await step.send('42', 'next');

    const deleted = messaging.deleteMessage.mock.calls.map(
      ([, id]: [string, string]) => id,
    );
    expect(deleted.sort()).toEqual(
      ['bot-prev', 'edit-overlay', 'step-a', 'step-b', 'user-a'].sort(),
    );
  });

  it('filters out undefined ids so delete never gets called with empty input', async () => {
    const ctx: Ctx = {
      lastBotMessageId: undefined,
      editStepMessageId: undefined,
      manualStepIds: [],
      userMessageIds: [],
    };
    const { step, messaging } = await build(ctx);

    await step.send('42', 'first ever');

    expect(messaging.deleteMessage).not.toHaveBeenCalled();
  });

  it('clears editStepMessageId in context before sending (overlay is consumed)', async () => {
    const ctx: Ctx = {
      editStepMessageId: 'edit-1',
      manualStepIds: [],
      userMessageIds: [],
    };
    const { step, conversation } = await build(ctx);

    await step.send('42', 'next');

    expect(conversation.setEditStepMessageId).toHaveBeenCalledWith(
      '42',
      undefined,
    );
  });

  it('forwards send options to the adapter (no parseMode → no opts)', async () => {
    const ctx: Ctx = { manualStepIds: [], userMessageIds: [] };
    const { step, messaging } = await build(ctx);

    await step.send('42', 'plain');

    expect(messaging.sendText).toHaveBeenCalledWith('42', 'plain', undefined);
  });
});
