import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { redisOptions } from './config';
@Injectable()
export class RedisConnection extends Redis implements OnModuleDestroy {
  constructor() {
    super({
      ...redisOptions(),
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      enableOfflineQueue: false,
    });
    this.on('error', () => {});
  }
  async onModuleDestroy(): Promise<void> {
    this.disconnect();
  }
}
@Global()
@Module({ providers: [RedisConnection], exports: [RedisConnection] })
export class RedisModule {}
