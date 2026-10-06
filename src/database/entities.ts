import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { Role } from '../auth/role-policy';
@Entity('users')
export class User {
  @PrimaryColumn('uuid') id!: string;
  @Column({ unique: true }) email!: string;
  @Column({ name: 'password_hash', select: false }) passwordHash!: string;
  @Column({ type: 'text' }) role!: Role;
}
@Entity('products')
@Index(['source', 'externalId'], { unique: true })
export class Product {
  @PrimaryColumn('uuid') id!: string;
  @Column() source!: string;
  @Column({ name: 'external_id' }) externalId!: string;
  @Column() name!: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 }) price!: string;
  @Column({ name: 'last_seen_run', type: 'uuid' }) lastSeenRun!: string;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @Column({ name: 'deletion_reason', type: 'text', nullable: true }) deletionReason!: string | null;
}
@Entity('variations')
@Index(['productId', 'identity'], { unique: true })
@Index(['productId', 'sku'], { unique: true })
export class Variation {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'product_id', type: 'uuid' }) productId!: string;
  @Column() sku!: string;
  @Column() identity!: string;
  @Column({ type: 'jsonb' }) attributes!: Record<string, string>;
}
@Entity('stock')
export class Stock {
  @PrimaryColumn({ name: 'variation_id', type: 'uuid' }) variationId!: string;
  @Column({ type: 'integer' }) quantity!: number;
}
