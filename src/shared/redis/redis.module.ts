import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { REDIS_CLIENT, RedisProvider } from './redis.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisProvider],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
