import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { RedisConnection } from '../common/redis.module';
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DataSource,
    private readonly redis: RedisConnection,
  ) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    try {
      await Promise.all([this.db.query('SELECT 1 FROM imports LIMIT 1'), this.redis.ping()]);
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Dependencies unavailable or migrations missing');
    }
  }
}
@Module({ controllers: [HealthController] })
export class HealthModule {}
