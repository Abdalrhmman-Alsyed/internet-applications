import { PATTERNS } from '@app/common';
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CategoriesService } from './categories.service';
import { FindProductsQuery, ImageUpload, ProductInput, ProductsService, StockItem } from './products.service';

@Controller()
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
  ) {}

  @MessagePattern(PATTERNS.health)
  health() {
    return { service: 'products', status: 'ok' };
  }

  // ─── Categories ───
  @MessagePattern(PATTERNS.categories.findAll)
  findCategories() {
    return this.categories.findAll();
  }

  @MessagePattern(PATTERNS.categories.create)
  createCategory(@Payload() { name }: { name: string }) {
    return this.categories.create(name);
  }

  @MessagePattern(PATTERNS.categories.remove)
  removeCategory(@Payload() { id }: { id: string }) {
    return this.categories.remove(id);
  }

  // ─── Products ───
  @MessagePattern(PATTERNS.products.findAll)
  findAll(@Payload() query: FindProductsQuery) {
    return this.products.findAll(query);
  }

  @MessagePattern(PATTERNS.products.findOne)
  findOne(@Payload() { id, includeInactive }: { id: string; includeInactive?: boolean }) {
    return this.products.findOne(id, includeInactive);
  }

  @MessagePattern(PATTERNS.products.create)
  create(@Payload() dto: ProductInput) {
    return this.products.create(dto);
  }

  @MessagePattern(PATTERNS.products.update)
  update(@Payload() { id, data }: { id: string; data: ProductInput }) {
    return this.products.update(id, data);
  }

  @MessagePattern(PATTERNS.products.remove)
  remove(@Payload() { id }: { id: string }) {
    return this.products.remove(id);
  }

  @MessagePattern(PATTERNS.products.addImage)
  addImage(@Payload() { id, file }: { id: string; file: ImageUpload }) {
    return this.products.addImage(id, file);
  }

  @MessagePattern(PATTERNS.products.removeImage)
  removeImage(@Payload() { id, imageId }: { id: string; imageId: string }) {
    return this.products.removeImage(id, imageId);
  }

  @MessagePattern(PATTERNS.products.updateStock)
  updateStock(@Payload() { id, stock, delta }: { id: string; stock?: number; delta?: number }) {
    return this.products.updateStock(id, { stock, delta });
  }

  // ─── Internal (called by orders-service only) ───
  @MessagePattern(PATTERNS.products.reserveStock)
  reserveStock(@Payload() { items }: { items: StockItem[] }) {
    return this.products.reserveStock(items);
  }

  @MessagePattern(PATTERNS.products.releaseStock)
  releaseStock(@Payload() { items }: { items: StockItem[] }) {
    return this.products.releaseStock(items);
  }
}
