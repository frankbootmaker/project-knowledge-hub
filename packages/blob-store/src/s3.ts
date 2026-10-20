import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { isBlobCredentialHeaderError, sanitizeS3Credential } from './credentials.js';
import type { BlobHead, BlobObject, BlobPutInput, BlobStore, BlobStoreConfig } from './types.js';

function normalizeEtag(value: string | undefined): string | null {
  if (!value) return null;
  const stripped = value.replaceAll('"', '').trim();
  return stripped.length > 0 ? stripped : null;
}

function encodeCopySource(bucket: string, key: string): string {
  return `${bucket}/${key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

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
  client: S3Client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: sanitizeS3Credential(config.accessKeyId),
      secretAccessKey: sanitizeS3Credential(config.secretAccessKey),
    },
  }),
): BlobStore {

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
        // Bad credentials must not block local-disk fallbacks (Dokploy paste).
        if (isBlobCredentialHeaderError(error)) return null;
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
    async head(key: string): Promise<BlobHead | null> {
      try {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: config.bucket,
            Key: withPrefix(key),
          }),
        );
        return {
          sizeBytes: result.ContentLength ?? 0,
          etag: normalizeEtag(result.ETag),
        };
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) return null;
        throw error;
      }
    },
    async copy(fromKey: string, toKey: string) {
      const destinationKey = withPrefix(toKey);
      await client.send(
        new CopyObjectCommand({
          Bucket: config.bucket,
          Key: destinationKey,
          CopySource: encodeCopySource(config.bucket, withPrefix(fromKey)),
        }),
      );
    },
    async list(prefix: string): Promise<BlobObject[]> {
      const fullPrefix = withPrefix(prefix);
      const objects: BlobObject[] = [];
      let continuationToken: string | undefined;
      for (let page = 0; page < 1000; page += 1) {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: fullPrefix,
            MaxKeys: 1000,
            ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
          }),
        );
        for (const item of result.Contents ?? []) {
          if (!item.Key) continue;
          objects.push({
            key: stripPrefix(item.Key),
            sizeBytes: item.Size,
            lastModified: item.LastModified,
          });
        }
        if (!result.IsTruncated || !result.NextContinuationToken) break;
        continuationToken = result.NextContinuationToken;
      }
      return objects;
    },
  };
}
