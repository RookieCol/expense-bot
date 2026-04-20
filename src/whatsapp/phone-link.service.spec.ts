import { Test, TestingModule } from '@nestjs/testing';
import { PhoneLinkService } from './phone-link.service';
import { REDIS_CLIENT } from '../shared/redis/redis.provider';

describe('PhoneLinkService', () => {
  let service: PhoneLinkService;
  let redis: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhoneLinkService,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();
    service = module.get(PhoneLinkService);
  });

  it('resolveToCanonical returns normalized phone when no link exists', async () => {
    await expect(service.resolveToCanonical('+57 300 123-4567')).resolves.toBe(
      '+573001234567',
    );
  });

  it('link stores under normalized key', async () => {
    await service.link('12345', '+57 300 123-4567');
    expect(redis.set).toHaveBeenCalledWith('phone:+573001234567', '12345');
  });

  it('resolveToCanonical returns stored telegramChatId when linked', async () => {
    redis.get.mockResolvedValueOnce('99');
    await expect(service.resolveToCanonical('+573001234567')).resolves.toBe(
      '99',
    );
    expect(redis.get).toHaveBeenCalledWith('phone:+573001234567');
  });

  it('falls back to normalized phone when Redis read errors', async () => {
    redis.get.mockRejectedValueOnce(new Error('network'));
    await expect(service.resolveToCanonical('+573001234567')).resolves.toBe(
      '+573001234567',
    );
  });
});
