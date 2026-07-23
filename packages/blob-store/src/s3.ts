import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { BlobObject, BlobPutInput, BlobStore, BlobStoreConfig } from './types.js';

function asBuffer(body: unknown): Buffer | null {
  if (!body) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  return null;
}

async function streamToBuffer(body: {
  transformToByteArray?: () => Promise<Uint8Array>;
}): Promise<Buffer | null> {
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  return null;
}

export function createS3BlobStore(
  config: Extract<BlobStoreConfig, { provider: 's3' }>,
): BlobStore {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  const withPrefix = (key: string): string => {
    const cleaned = key.replace(/^\/+/, '');
    if (!config.keyPrefix) return cleaned;
    return `${config.keyPrefix.replace(/\/+$/, '')}/${cleaned}`;
  };

  const stripPrefix = (key: string): string => {
    if (!config.keyPrefix) return key;
    const prefix = `${config.keyPrefix.replace(/\/+$/, '')}/`;
    return key.startsWith(prefix) ? key.slice(prefix.length) : key;
  };

  return {
    provider: 's3',
    async put(input: BlobPutInput) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: withPrefix(input.key),
          Body: input.body,
          ContentType: input.contentType ?? 'application/octet-stream',
        }),
      );
    },
    async get(key: string) {
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: withPrefix(key),
          }),
        );
        if (!result.Body) return null;
        const fromSdk = await streamToBuffer(
          result.Body as { transformToByteArray?: () => Promise<Uint8Array> },
        );
        if (fromSdk) return fromSdk;
        return asBuffer(result.Body);
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'NoSuchKey' || name === 'NotFound') return null;
        throw error;
      }
    },
    async delete(key: string) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: withPrefix(key),
        }),
      );
    },
    async list(prefix: string): Promise<BlobObject[]> {
      const fullPrefix = withPrefix(prefix);
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: fullPrefix,
          MaxKeys: 200,
        }),
      );
      return (result.Contents ?? [])
        .filter((item) => Boolean(item.Key))
        .map((item) => ({
          key: stripPrefix(item.Key!),
          sizeBytes: item.Size,
          lastModified: item.LastModified,
        }));
    },
  };
}
