import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const RedisProvider = {
  provide: REDIS_CLIENT,
  useFactory: (config: ConfigService): Redis => {
    const url = config.get<string>('UPSTASH_REDIS_REST_URL');
    const token = config.get<string>('UPSTASH_REDIS_REST_TOKEN');
    if (!url || !token) {
      throw new Error(
        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required',
      );
    }
    return new Redis({ url, token });
  },
  inject: [ConfigService],
};
