import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { databaseOptions } from './database/data-source';
import { redisOptions } from './common/config';
import { RedisModule } from './common/redis.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { ImportsModule } from './imports/imports.module';
import { HealthModule } from './health/health.module';
@Module({
  imports: [
    TypeOrmModule.forRootAsync({ useFactory: databaseOptions }),
    RedisModule,
    BullModule.forRootAsync({ useFactory: () => ({ connection: redisOptions() }) }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 600 }]),
    AuthModule,
    CatalogModule,
    ImportsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
