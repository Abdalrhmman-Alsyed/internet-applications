import { CacheService, PERF_OPTIMIZED } from '@app/common';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ReplicaPrismaService } from './replica-prisma.service';

const slugify = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '');

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly replica: ReplicaPrismaService,
    private readonly cache: CacheService,
  ) {}

  /** Cached with the catalogue (the product counts change when products do). */
  async findAll() {
    const key = `catalog:v${await this.cache.version('catalog')}:categories`;
    const db = !PERF_OPTIMIZED || (await this.cache.isFresh('catalog')) ? this.prisma : this.replica;
    return this.cache.getOrSet(key, 300, () =>
      db.category.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { products: { where: { isActive: true } } } } },
      }),
    );
  }

  async create(name: string) {
    const slug = slugify(name);
    if (await this.prisma.category.findFirst({ where: { OR: [{ name }, { slug }] } })) {
      throw new ConflictException('Category already exists');
    }
    const category = await this.prisma.category.create({ data: { name: name.trim(), slug } });
    await Promise.all([this.cache.bump('catalog'), this.cache.markFresh('catalog')]);
    return category;
  }

  async remove(id: string) {
    if (!(await this.prisma.category.findUnique({ where: { id } }))) {
      throw new NotFoundException('Category not found');
    }
    await this.prisma.category.delete({ where: { id } });
    await Promise.all([this.cache.bump('catalog'), this.cache.markFresh('catalog')]); // its products are now uncategorised
    return { success: true };
  }
}
