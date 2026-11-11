import { EVENTS, EVENTS_BUS, InventoryClient, paginate, ProductLowStockEvent } from '@app/common';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

/**
 * `stock` comes from inventory-service. If it can't be reached, products are still
 * shown with stock 0 and `inventoryAvailable: false`, so browsing keeps working.
 */
const toDto = (p: ProductWithRelations, stock: number, inventoryAvailable: boolean) => ({
  ...p,
  price: p.price.toNumber(),
  stock,
  inventoryAvailable,
});

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

export interface ImageUpload {
  base64: string;
  mimetype: string;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly inventory: InventoryClient,
    @Inject(EVENTS_BUS) private readonly events: ClientProxy,
  ) {}

  async findAll(q: FindProductsQuery) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;

    // Stock filters are answered by inventory-service (one call), then applied as an id filter.
    let stockIds: string[] | undefined;
    if (q.inStock || q.maxStock !== undefined) {
      const levels = await this.inventory.listStock({ min: q.inStock ? 1 : undefined, max: q.maxStock });
      stockIds = levels.map((l) => l.productId);
    }

    const where: Prisma.ProductWhereInput = {
      ...(!q.includeInactive && { isActive: true }),
      ...(q.categoryId && { categoryId: q.categoryId }),
      ...(stockIds && { id: { in: stockIds } }),
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
    return paginate(await this.withStock(items), total, page, limit);
  }

  async findOne(id: string, includeInactive = false) {
    const product = await this.load(id, includeInactive);
    return (await this.withStock([product]))[0];
  }

  /**
   * Called by orders-service when an order is placed: names and current prices,
   * straight from this database (never from the client).
   */
  async forOrder(ids: string[]) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, name: true, price: true },
    });
    const missing = ids.find((id) => !products.some((p) => p.id === id));
    if (missing) throw new NotFoundException(`Product ${missing} not found`);
    return products.map((p) => ({ productId: p.id, name: p.name, unitPrice: p.price.toNumber() }));
  }

  async create(dto: ProductInput) {
    await this.assertCategory(dto.categoryId);
    const product = await this.prisma.product.create({
      data: {
        name: dto.name!,
        description: dto.description ?? '',
        price: dto.price!,
        categoryId: dto.categoryId ?? null,
      },
      include: productInclude,
    });
    // A product without a stock record would be unsellable; undo the insert if inventory refuses.
    try {
      const stock = await this.inventory.setStock(product.id, { quantity: dto.stock ?? 0 });
      return toDto(product, stock, true);
    } catch (err) {
      await this.prisma.product.delete({ where: { id: product.id } });
      throw err;
    }
  }

  async update(id: string, dto: ProductInput) {
    const { stock, ...data } = dto;
    await this.load(id, true);
    await this.assertCategory(data.categoryId);
    await this.prisma.product.update({ where: { id }, data });
    if (stock !== undefined) {
      await this.inventory.setStock(id, { quantity: stock });
    }
    const product = await this.findOne(id, true);
    this.checkLowStock(product);
    return product;
  }

  async remove(id: string) {
    await this.load(id, true);
    await this.prisma.product.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  }

  async addImage(productId: string, file: ImageUpload) {
    await this.load(productId, true);
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
    await this.load(id, true);
    if (stock !== undefined) {
      await this.inventory.setStock(id, { quantity: stock });
    } else if (delta !== undefined) {
      await this.inventory.setStock(id, { delta });
    } else {
      throw new BadRequestException('Provide either "stock" or "delta"');
    }
    const product = await this.findOne(id, true);
    this.checkLowStock(product);
    return product;
  }

  private async load(id: string, includeInactive: boolean) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: productInclude });
    if (!product || (!product.isActive && !includeInactive)) throw new NotFoundException('Product not found');
    return product;
  }

  /** Adds stock to products with a single CheckStock call for the whole page (no N+1). */
  private async withStock(products: ProductWithRelations[]) {
    try {
      const stock = await this.inventory.checkStock(products.map((p) => p.id));
      return products.map((p) => toDto(p, stock.get(p.id) ?? 0, true));
    } catch (err) {
      this.logger.warn(`Inventory unavailable, showing products without stock: ${(err as Error).message}`);
      return products.map((p) => toDto(p, 0, false));
    }
  }

  private async assertCategory(categoryId?: string | null) {
    if (categoryId && !(await this.prisma.category.findUnique({ where: { id: categoryId } }))) {
      throw new BadRequestException('Category does not exist');
    }
  }

  private checkLowStock(p: { id: string; name: string; stock: number; inventoryAvailable: boolean }) {
    if (!p.inventoryAvailable || p.stock > LOW_STOCK_THRESHOLD) return;
    this.events.emit<void, ProductLowStockEvent>(EVENTS.productLowStock, { productId: p.id, name: p.name, stock: p.stock });
  }
}
