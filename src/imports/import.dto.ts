import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
export class VariationDto {
  @ApiProperty() @Matches(/^[A-Za-z0-9._-]{1,120}$/) sku!: string;
  @ApiProperty({ example: { color: 'blue' } }) @IsObject() attributes!: Record<string, string>;
  @ApiProperty() @IsInt() @Min(0) @Max(2147483647) quantity!: number;
}
export class ProductDto {
  @ApiProperty({ required: false, default: false }) @IsOptional() @IsBoolean() deleted?: boolean;
  @ApiProperty() @Matches(/^[A-Za-z0-9._-]{1,120}$/) externalId!: string;
  @ApiProperty() @IsString() @MaxLength(240) name!: string;
  @ApiProperty({ example: '19.90' }) @Matches(/^(0|[1-9]\d{0,9})\.\d{2}$/) price!: string;
  @ApiProperty({ type: [VariationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VariationDto)
  variations!: VariationDto[];
}
export class CreateImportDto {
  @ApiProperty({ example: 'synthetic-supplier' })
  @Matches(/^[a-z0-9][a-z0-9_-]{0,79}$/)
  source!: string;
  @ApiProperty({ enum: ['delta', 'snapshot'] }) @IsIn(['delta', 'snapshot']) mode!:
    'delta' | 'snapshot';
  @ApiProperty({ example: 'fixture-v1' })
  @Matches(/^[A-Za-z0-9._-]{1,128}$/)
  idempotencyKey!: string;
  @ApiProperty({ minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  expectedBatches!: number;
}
export class BatchDto {
  @ApiProperty({ type: [ProductDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProductDto)
  products!: ProductDto[];
}
