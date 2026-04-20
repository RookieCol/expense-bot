import { Test, TestingModule } from '@nestjs/testing';
import { ConversationService } from './conversation.service';
import { ConversationState } from './conversation-state.enum';
import { REDIS_CLIENT } from '../shared/redis/redis.provider';

describe('ConversationService', () => {
  let service: ConversationService;
  let redis: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();
    service = module.get(ConversationService);
  });

  it('returns a fresh IDLE context for an unknown chatId', async () => {
    await service.load('123');
    const ctx = service.getContext('123');
    expect(ctx.state).toBe(ConversationState.IDLE);
    expect(ctx.pendingExpense).toEqual({});
    expect(ctx.manualStepIds).toEqual([]);
  });

  it('hydrates cached context from Redis', async () => {
    redis.get.mockResolvedValueOnce({
      state: ConversationState.WAITING_AMOUNT,
      pendingExpense: { proveedor: 'Mercado' },
      manualStepIds: ['m1'],
      userMessageIds: [],
      userName: '@alice',
    });
    await service.load('123');
    const ctx = service.getContext('123');
    expect(ctx.state).toBe(ConversationState.WAITING_AMOUNT);
    expect(ctx.pendingExpense.proveedor).toBe('Mercado');
    expect(ctx.userName).toBe('@alice');
  });

  it('flush persists mutated state with TTL', async () => {
    await service.load('123');
    service.setState('123', ConversationState.WAITING_PROVIDER);
    service.updatePending('123', { monto: 50 });
    await service.flush('123');
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, value, opts] = redis.set.mock.calls[0] as [
      string,
      { state: ConversationState; pendingExpense: { monto?: number } },
      { ex: number },
    ];
    expect(key).toBe('conv:123');
    expect(value.state).toBe(ConversationState.WAITING_PROVIDER);
    expect(value.pendingExpense.monto).toBe(50);
    expect(opts.ex).toBe(7200);
  });

  it('flush is a no-op when nothing was mutated', async () => {
    await service.load('123');
    service.getContext('123'); // read-only
    await service.flush('123');
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('flush drops the cache so next request reloads from Redis', async () => {
    await service.load('123');
    service.setState('123', ConversationState.WAITING_AMOUNT);
    await service.flush('123');

    redis.get.mockResolvedValueOnce({
      state: ConversationState.WAITING_CONFIRMATION,
      pendingExpense: {},
      manualStepIds: [],
      userMessageIds: [],
    });
    await service.load('123');
    expect(service.getContext('123').state).toBe(
      ConversationState.WAITING_CONFIRMATION,
    );
  });

  it('reset preserves userName + lastBotMessageId and clears the rest', async () => {
    await service.load('123');
    service.setUserName('123', '@alice');
    service.setLastBotMessageId('123', 'm42');
    service.setState('123', ConversationState.WAITING_AMOUNT);
    service.updatePending('123', { monto: 100 });

    service.reset('123');
    const ctx = service.getContext('123');
    expect(ctx.state).toBe(ConversationState.IDLE);
    expect(ctx.pendingExpense).toEqual({});
    expect(ctx.userName).toBe('@alice');
    expect(ctx.lastBotMessageId).toBe('m42');
  });

  it('setImageBuffer keeps the buffer in-memory only (not serialized)', async () => {
    await service.load('123');
    const buf = Buffer.from('fake-image');
    service.setImageBuffer('123', buf);
    expect(service.getContext('123').lastImageBuffer).toBe(buf);
    await service.flush('123');
    // Not called because no dirty mutations (image buffer is not tracked for persistence)
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('falls back to fresh context when Redis load fails', async () => {
    redis.get.mockRejectedValueOnce(new Error('network'));
    await service.load('123');
    expect(service.getContext('123').state).toBe(ConversationState.IDLE);
  });

  it('pendingMenuOptions round-trip through flush/load', async () => {
    await service.load('123');
    service.setPendingMenuOptions('123', ['opt_a', 'opt_b', 'opt_c']);
    await service.flush('123');

    const written = redis.set.mock.calls[0][1] as {
      pendingMenuOptions?: string[];
    };
    expect(written.pendingMenuOptions).toEqual(['opt_a', 'opt_b', 'opt_c']);
  });
});
