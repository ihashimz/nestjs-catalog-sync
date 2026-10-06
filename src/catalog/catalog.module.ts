import { Controller, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthModule } from '../auth/auth.module';
import { JwtGuard, Roles, RolesGuard } from '../auth/guards';
import { RedisConnection } from '../common/redis.module';
export class ProductQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9][a-z0-9_-]{0,79}$/) source?: string;
  @ApiPropertyOptional({ default: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @ApiPropertyOptional({ default: 20 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
@Injectable()
export class CatalogService {
  constructor(
    private readonly db: DataSource,
    private readonly redis: RedisConnection,
  ) {}
  async list(q: ProductQuery): Promise<unknown> {
    const key = `catalog:${q.source ?? '*'}:${q.page}:${q.limit}`;
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as unknown;
    } catch {
      /* PostgreSQL remains available when cache fails. */
    }
    const items: unknown[] = await this.db.query(
      `WITH page AS (SELECT * FROM products WHERE deleted_at IS NULL AND ($1::varchar IS NULL OR source=$1) ORDER BY id LIMIT $2 OFFSET $3)
      SELECT p.id,p.source,p.external_id AS "externalId",p.name,p.price,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'attributes',v.attributes,'quantity',s.quantity) ORDER BY v.identity) FROM variations v JOIN stock s ON s.variation_id=v.id WHERE v.product_id=p.id),'[]'::jsonb) AS variations FROM page p ORDER BY p.id`,
      [q.source ?? null, q.limit, (q.page - 1) * q.limit],
    );
    const result = { items, page: q.page, limit: q.limit };
    // Bounded staleness (30s) avoids a cache-invalidation transaction crossing Redis and PostgreSQL.
    try {
      await this.redis.set(key, JSON.stringify(result), 'EX', 30);
    } catch {
      /* Cache is best effort. */
    }
    return result;
  }
}
@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(JwtGuard, RolesGuard)
@Roles('viewer', 'manager')
@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get() list(@Query() query: ProductQuery) {
    return this.catalog.list(query);
  }
}
@Module({ imports: [AuthModule], controllers: [CatalogController], providers: [CatalogService] })
export class CatalogModule {}
