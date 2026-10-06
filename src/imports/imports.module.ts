import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AuthModule } from '../auth/auth.module';
import { JwtGuard, Roles, RolesGuard } from '../auth/guards';
import { BatchDto, CreateImportDto } from './import.dto';
import { PostgresImportStore } from './postgres-import.store';
@Injectable()
export class ImportDispatch {
  constructor(
    @InjectQueue('catalog-imports') private readonly queue: Queue,
    private readonly store: PostgresImportStore,
  ) {}
  async enqueue(id: string): Promise<void> {
    await this.queue.add(
      'import',
      { runId: id },
      {
        jobId: id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 604800, count: 1000 },
      },
    );
  }
  async reconcile(): Promise<void> {
    for (const run of await this.store.dispatchable()) {
      const job = await this.queue.getJob(run.id);
      const state = job ? await job.getState() : undefined;
      if (job && (state === 'failed' || state === 'completed')) {
        // Adding a retained terminal job with the same ID does not schedule it again.
        // PostgreSQL owns the retry budget; Redis delivery attempts can be reset safely.
        if (run.attempt_count >= 3) await this.store.recordFailure(run.id);
        else await job.retry(state, { resetAttemptsMade: true, resetAttemptsStarted: true });
      } else if (!job) {
        await this.enqueue(run.id);
      }
    }
  }
}
@ApiTags('imports')
@ApiBearerAuth()
@UseGuards(JwtGuard, RolesGuard)
@Roles('manager')
@Controller('imports')
export class ImportsController {
  constructor(private readonly store: PostgresImportStore) {}
  @Post() create(@Body() dto: CreateImportDto) {
    return this.store.create(dto);
  }
  @Put(':id/batches/:ordinal') async stage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ordinal', ParseIntPipe) ordinal: number,
    @Body() dto: BatchDto,
  ) {
    await this.store.stage(id, ordinal, dto.products);
    return { staged: true };
  }
  // PostgreSQL is the durable dispatch intent; Redis delivery is reconciled by the worker.
  @Post(':id/seal') seal(@Param('id', ParseUUIDPipe) id: string) {
    return this.store.seal(id);
  }
  @Get(':id') status(@Param('id', ParseUUIDPipe) id: string) {
    return this.store.get(id);
  }
  @Delete(':id') async abort(@Param('id', ParseUUIDPipe) id: string) {
    await this.store.abort(id);
    return { aborted: true };
  }
}
@Module({
  imports: [AuthModule, BullModule.registerQueue({ name: 'catalog-imports' })],
  controllers: [ImportsController],
  providers: [PostgresImportStore, ImportDispatch],
  exports: [PostgresImportStore, ImportDispatch, BullModule],
})
export class ImportsModule {}
