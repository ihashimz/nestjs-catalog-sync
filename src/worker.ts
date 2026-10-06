import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { createServer } from 'node:http';
import { databaseOptions } from './database/data-source';
import { checkConfig, redisOptions } from './common/config';
import { RedisModule, RedisConnection } from './common/redis.module';
import { ImportsModule } from './imports/imports.module';
import { ImportWorker, SupplierWorker, WorkerSchedules } from './imports/import.worker';
import { SupplierService } from './supplier/supplier.service';
@Module({
  imports: [
    TypeOrmModule.forRootAsync({ useFactory: databaseOptions }),
    RedisModule,
    BullModule.forRootAsync({ useFactory: () => ({ connection: redisOptions() }) }),
    BullModule.registerQueue({ name: 'supplier-sync' }),
    ScheduleModule.forRoot(),
    ImportsModule,
  ],
  providers: [ImportWorker, SupplierWorker, WorkerSchedules, SupplierService],
})
class WorkerModule {}
async function main(): Promise<void> {
  checkConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const db = app.get(DataSource);
  const redis = app.get(RedisConnection);
  const server = createServer((req, res) => {
    void (async () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/health/live') {
        res.end('{"status":"ok"}');
        return;
      }
      if (req.url !== '/health/ready') {
        res.statusCode = 404;
        res.end('{}');
        return;
      }
      try {
        await Promise.all([db.query('SELECT 1 FROM imports LIMIT 1'), redis.ping()]);
        res.end('{"status":"ready"}');
      } catch {
        res.statusCode = 503;
        res.end('{"status":"unavailable"}');
      }
    })();
  });
  server.listen(Number(process.env.WORKER_HEALTH_PORT ?? 3001), '0.0.0.0');
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      server.close();
      void app.close().catch(() => {
        process.exitCode = 1;
      });
    });
}
void main().catch(() => {
  console.error('Worker startup failed; verify configuration and dependencies');
  process.exitCode = 1;
});
