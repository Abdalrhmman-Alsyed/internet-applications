import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';
import { randomUUID } from 'crypto';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Product images live in MinIO (S3-compatible), not on the container's disk. */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket = process.env.MINIO_BUCKET ?? 'products';
  private readonly publicUrl = process.env.MINIO_PUBLIC_URL ?? 'http://localhost:9000';
  private readonly client = new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY ?? 'minio',
    secretKey: process.env.MINIO_SECRET_KEY ?? 'minio_password',
  });

  async onModuleInit() {
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Created bucket "${this.bucket}"`);
    }
    // Images are public to read (shop pages); only this service can write.
    await this.client.setBucketPolicy(
      this.bucket,
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          { Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${this.bucket}/*`] },
        ],
      }),
    );
  }

  async upload(productId: string, buffer: Buffer, mimetype: string) {
    const key = `${productId}/${randomUUID()}.${EXTENSIONS[mimetype] ?? 'bin'}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, { 'Content-Type': mimetype });
    return { key, url: `${this.publicUrl}/${this.bucket}/${key}` };
  }

  async remove(key: string) {
    await this.client.removeObject(this.bucket, key);
  }
}
