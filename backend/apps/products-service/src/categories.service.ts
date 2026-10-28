import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

const slugify = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '');

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: { where: { isActive: true } } } } },
    });
  }

  async create(name: string) {
    const slug = slugify(name);
    if (await this.prisma.category.findFirst({ where: { OR: [{ name }, { slug }] } })) {
      throw new ConflictException('Category already exists');
    }
    return this.prisma.category.create({ data: { name: name.trim(), slug } });
  }

  async remove(id: string) {
    if (!(await this.prisma.category.findUnique({ where: { id } }))) {
      throw new NotFoundException('Category not found');
    }
    await this.prisma.category.delete({ where: { id } });
    return { success: true };
  }
}
