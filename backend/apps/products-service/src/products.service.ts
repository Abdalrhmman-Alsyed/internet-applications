import { EVENTS, EVENTS_BUS, paginate, ProductLowStockEvent } from '@app/common';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Prisma } from '@prisma-clients/products';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';

const MAX_IMAGES_PER_PRODUCT = 8;
const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD ?? 5);

const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
  images: { orderBy: { position: 'asc' }, select: { id: true, url: true, position: true } },
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

const toDto = (p: ProductWithRelations) => ({ ...p, price: p.price.toNumber() });

export interface FindProductsQuery {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  maxStock?: number;
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'name';
  includeInactive?: boolean;
}

export interface ProductInput {
  name?: string;
  description?: string;
  price?: number;
  stock?: number;
  categoryId?: string | null;
  isActive?: boolean;
}

export interface StockItem {
  productId: string;
  quantity: number;
}

export interface ImageUpload {
  base64: string;
  mimetype: string;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(EVENTS_BUS) private readonly events: ClientProxy,
  ) {}

  async findAll(q: FindProductsQuery) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const where: Prisma.ProductWhereInput = {
      ...(!q.includeInactive && { isActive: true }),
      ...(q.categoryId && { categoryId: q.categoryId }),
      ...((q.inStock || q.maxStock !== undefined) && {
        stock: { gt: q.inStock ? 0 : undefined, lte: q.maxStock },
      }),
      ...((q.minPrice !== undefined || q.maxPrice !== undefined) && {
        price: { gte: q.minPrice, lte: q.maxPrice },
      }),
      ...(q.search && {
        OR: [
          { name: { contains: q.search, mode: 'insensitive' } },
          { description: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const orderBy: Prisma.ProductOrderByWithRelationInput =
      q.sort === 'price_asc' ? { price: 'asc' }
      : q.sort === 'price_desc' ? { price: 'desc' }
      : q.sort === 'name' ? { name: 'asc' }
      : { createdAt: 'desc' };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit, include: productInclude }),
      this.prisma.product.count({ where }),
    ]);
    return paginate(items.map(toDto), total, page, limit);
  }

  async findOne(id: string, includeInactive = false) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: productInclude });
    if (!product || (!product.isActive && !includeInactive)) throw new NotFoundException('Product not found');
    return toDto(product);
  }

  async create(dto: ProductInput) {
    await this.assertCategory(dto.categoryId);
    const product = await this.prisma.product.create({
      data: {
        name: dto.name!,
        description: dto.description ?? '',
        price: dto.price!,
        stock: dto.stock ?? 0,
        categoryId: dto.categoryId ?? null,
      },
      include: productInclude,
    });
    return toDto(product);
  }

  async update(id: string, dto: ProductInput) {
    await this.findOne(id, true);
    await this.assertCategory(dto.categoryId);
    const product = await this.prisma.product.update({ where: { id }, data: dto, include: productInclude });
    await this.checkLowStock([product]);
    return toDto(product);
  }

  async remove(id: string) {
    await this.findOne(id, true);
    await this.prisma.product.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  }

  async addImage(productId: string, file: ImageUpload) {
    await this.findOne(productId, true);
    const count = await this.prisma.productImage.count({ where: { productId } });
    if (count >= MAX_IMAGES_PER_PRODUCT) {
      throw new BadRequestException(`A product can have at most ${MAX_IMAGES_PER_PRODUCT} images`);
    }
    const { key, url } = await this.storage.upload(productId, Buffer.from(file.base64, 'base64'), file.mimetype);
    await this.prisma.productImage.create({ data: { productId, key, url, position: count } });
    return this.findOne(productId, true);
  }

  async removeImage(productId: string, imageId: string) {
    const image = await this.prisma.productImage.findFirst({ where: { id: imageId, productId } });
    if (!image) throw new NotFoundException('Image not found');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.storage.remove(image.key);
    return this.findOne(productId, true);
  }

  /** Inventory management: set an absolute value or adjust by a delta (never below zero). */
  async updateStock(id: string, { stock, delta }: { stock?: number; delta?: number }) {
    await this.findOne(id, true);
    if (stock !== undefined) {
      await this.prisma.product.update({ where: { id }, data: { stock } });
    } else if (delta !== undefined) {
      const { count } = await this.prisma.product.updateMany({
        where: { id, stock: { gte: Math.max(0, -delta) } },
        data: { stock: { increment: delta } },
      });
      if (count === 0) throw new ConflictException('Stock cannot go below zero');
    } else {
      throw new BadRequestException('Provide either "stock" or "delta"');
    }
    const product = await this.findOne(id, true);
    await this.checkLowStock([product]);
    return product;
  }

  /**
   * Called by orders-service when an order is placed. Decrements stock atomically
   * inside one transaction: each UPDATE only succeeds if enough stock remains, so
   * two concurrent orders can never oversell the last unit.
   */
  async reserveStock(rawItems: StockItem[]) {
    const items = mergeItems(rawItems);
    const reserved = await this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: items.map((i) => i.productId) }, isActive: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      for (const item of items) {
        const product = byId.get(item.productId);
        if (!product) throw new NotFoundException(`Product ${item.productId} not found`);
        const { count } = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (count === 0) throw new ConflictException(`Insufficient stock for "${product.name}"`);
      }
      return items.map((i) => {
        const p = byId.get(i.productId)!;
        return { productId: p.id, name: p.name, unitPrice: p.price.toNumber(), quantity: i.quantity };
      });
    });
    const after = await this.prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
    await this.checkLowStock(after);
    return reserved;
  }

  /** Puts stock back when an order is cancelled (or creation fails after reserving). */
  async releaseStock(rawItems: StockItem[]) {
    const items = mergeItems(rawItems);
    await this.prisma.$transaction(
      items.map((i) =>
        this.prisma.product.updateMany({ where: { id: i.productId }, data: { stock: { increment: i.quantity } } }),
      ),
    );
    return { success: true };
  }

  private async assertCategory(categoryId?: string | null) {
    if (categoryId && !(await this.prisma.category.findUnique({ where: { id: categoryId } }))) {
      throw new BadRequestException('Category does not exist');
    }
  }

  private async checkLowStock(products: { id: string; name: string; stock: number }[]) {
    for (const p of products.filter((p) => p.stock <= LOW_STOCK_THRESHOLD)) {
      this.events.emit<void, ProductLowStockEvent>(EVENTS.productLowStock, {
        productId: p.id,
        name: p.name,
        stock: p.stock,
      });
    }
  }
}

function mergeItems(items: StockItem[]): StockItem[] {
  const merged = new Map<string, number>();
  for (const { productId, quantity } of items) merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}
