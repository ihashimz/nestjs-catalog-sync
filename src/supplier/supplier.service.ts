import { Injectable } from '@nestjs/common';
import { PostgresImportStore } from '../imports/postgres-import.store';
import { classifyFailure, SupplierFailure } from '../common/failure';
import { readBoundedJson, parseSupplierPage } from './supplier-policy';
@Injectable()
export class SupplierService {
  constructor(private readonly store: PostgresImportStore) {}
  async sync(day: string): Promise<void> {
    if (!process.env.SUPPLIER_URL) return;
    const pageOne = await this.fetchPage(1);
    const run = await this.store.create({
      source: process.env.SUPPLIER_SOURCE ?? 'configured-supplier',
      mode: 'snapshot',
      expectedBatches: pageOne.totalPages,
      idempotencyKey: `daily-${day}`,
    });
    if (run.status !== 'staging') return;
    await this.store.stage(run.id, 0, pageOne.products);
    for (let page = 2; page <= pageOne.totalPages; page++) {
      const next = await this.fetchPage(page);
      if (next.totalPages !== pageOne.totalPages) throw new SupplierFailure('SNAPSHOT_CHANGED');
      await this.store.stage(run.id, page - 1, next.products);
    }
    await this.store.seal(run.id);
  }
  private async fetchPage(page: number) {
    const url = new URL(process.env.SUPPLIER_URL!);
    url.searchParams.set('page', String(page));
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
      headers: process.env.SUPPLIER_TOKEN
        ? { Authorization: `Bearer ${process.env.SUPPLIER_TOKEN}` }
        : {},
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SupplierFailure('HTTP_RESPONSE', response.status);
    }
    try {
      return parseSupplierPage(await readBoundedJson(response));
    } catch (error) {
      if (
        error instanceof SupplierFailure ||
        ['timeout', 'network'].includes(classifyFailure(error).kind)
      )
        throw error;
      throw new SupplierFailure('INVALID_PAYLOAD');
    }
  }
}
