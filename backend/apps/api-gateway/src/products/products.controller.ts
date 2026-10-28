import { AuthUser, PATTERNS, PRODUCTS_SERVICE, Role, sendRpc } from '@app/common';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { assertImage, MAX_IMAGE_BYTES } from './image-validation';
import { CreateCategoryDto, CreateProductDto, ProductsQueryDto, UpdateProductDto, UpdateStockDto } from './products.dto';

const isAdmin = (user?: AuthUser) => user?.role === Role.ADMIN;

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(@Inject(PRODUCTS_SERVICE) private readonly products: ClientProxy) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List categories' })
  findAll() {
    return sendRpc(this.products, PATTERNS.categories.findAll, {});
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({ summary: '[Admin] Create a category' })
  @ApiForbiddenResponse({ description: 'Not an admin' })
  create(@Body() dto: CreateCategoryDto) {
    return sendRpc(this.products, PATTERNS.categories.create, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: '[Admin] Delete a category (its products become uncategorised)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return sendRpc(this.products, PATTERNS.categories.remove, { id });
  }
}

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(@Inject(PRODUCTS_SERVICE) private readonly products: ClientProxy) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List products: pagination, search, category/price filters, sorting' })
  findAll(@Query() query: ProductsQueryDto, @CurrentUser() user?: AuthUser) {
    // Hidden (soft-deleted) products are only visible to admins.
    return sendRpc(this.products, PATTERNS.products.findAll, { ...query, includeInactive: isAdmin(user) });
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Product details with images' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return sendRpc(this.products, PATTERNS.products.findOne, { id, includeInactive: isAdmin(user) });
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({ summary: '[Admin] Create a product' })
  @ApiForbiddenResponse({ description: 'Not an admin' })
  create(@Body() dto: CreateProductDto) {
    return sendRpc(this.products, PATTERNS.products.create, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: '[Admin] Update a product' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return sendRpc(this.products, PATTERNS.products.update, { id, data: dto });
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: '[Admin] Hide a product (soft delete)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return sendRpc(this.products, PATTERNS.products.remove, { id });
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: '[Admin] Upload a product image (JPEG/PNG/WebP, max 5 MB)' })
  addImage(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    const mimetype = assertImage(file);
    return sendRpc(this.products, PATTERNS.products.addImage, {
      id,
      file: { base64: file.buffer.toString('base64'), mimetype },
    }, 20_000);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete(':id/images/:imageId')
  @ApiOperation({ summary: '[Admin] Delete a product image' })
  removeImage(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return sendRpc(this.products, PATTERNS.products.removeImage, { id, imageId });
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id/stock')
  @ApiOperation({ summary: '[Admin] Inventory: set stock or adjust by delta' })
  updateStock(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStockDto) {
    return sendRpc(this.products, PATTERNS.products.updateStock, { id, ...dto });
  }
}
