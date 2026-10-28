import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../common/pagination.dto';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

export class CreateProductDto {
  /** @example Wireless Headphones */
  @IsString()
  @Length(2, 120)
  name!: string;

  /** @example Bluetooth 5.3, 30h battery */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** @example 49.99 */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  price!: number;

  /** @example 25 */
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {
  /** Re-activate or hide a product */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateStockDto {
  /** Set stock to an absolute value */
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  /** Or adjust by a delta, e.g. +10 (restock) or -2 (damaged) */
  @IsOptional()
  @IsInt()
  delta?: number;
}

export class ProductsQueryDto extends PaginationQueryDto {
  /** Search in name and description */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  /** Only products with stock > 0 */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  inStock?: boolean;

  /** Low-stock view: products with stock ≤ this value */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxStock?: number;

  @IsOptional()
  @IsIn(['newest', 'price_asc', 'price_desc', 'name'])
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'name';
}

export class CreateCategoryDto {
  /** @example Electronics */
  @IsString()
  @Length(2, 60)
  name!: string;
}
