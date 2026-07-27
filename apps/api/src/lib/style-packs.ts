/**
 * Doc Factory style packs (Phase E): presentation tokens + optional logo.
 * Built-in Blank is synthetic and never stored in the database.
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import {
  blobObjectKey,
  type BlobStore,
} from '@project-knowledge-hub/blob-store';
import {
  stylePacks,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { z } from 'zod';
import { prepareStylePackLogoForPrint } from './style-pack-logo.js';

export const BLANK_STYLE_PACK_ID = 'blank' as const;

export const STYLE_PACK_STATUSES = ['active', 'archived'] as const;
export type StylePackStatus = (typeof STYLE_PACK_STATUSES)[number];

export const STYLE_PACK_FORMATS = ['pdf', 'docx'] as const;
export type StylePackFormat = (typeof STYLE_PACK_FORMATS)[number];

const ALLOWED_LOGO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const stylePackTypographySchema = z
  .object({
    bodyFont: z.string().min(1).max(80).optional(),
    headingFont: z.string().min(1).max(80).optional(),
    monoFont: z.string().min(1).max(80).optional(),
    bodyColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    headingColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    mutedColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
  })
  .strict();

export const stylePackChromeSchema = z
  .object({
    headerText: z.string().max(200).optional(),
    footerText: z.string().max(200).optional(),
    disclaimer: z.string().max(500).optional(),
    showLogo: z.boolean().optional(),
    showCoverBrand: z.boolean().optional(),
    /** Cover H1 title above the record body. */
    showCoverTitle: z.boolean().optional(),
    /** Meta line, summary, and exported timestamp under the cover title. */
    showCoverDetails: z.boolean().optional(),
    marginTopMm: z.number().min(8).max(40).optional(),
    marginBottomMm: z.number().min(8).max(40).optional(),
    marginLeftMm: z.number().min(8).max(40).optional(),
    marginRightMm: z.number().min(8).max(40).optional(),
  })
  .strict();

export type StylePackTypography = z.infer<typeof stylePackTypographySchema>;
export type StylePackChrome = z.infer<typeof stylePackChromeSchema>;

export type PublicStylePack = {
  id: string;
  organizationId: string | null;
  slug: string;
  label: string;
  status: StylePackStatus;
  formats: StylePackFormat[];
  typography: StylePackTypography;
  chrome: StylePackChrome;
  hasLogo: boolean;
  logoContentType: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** True for the synthetic Blank pack. */
  builtin: boolean;
};

/** Resolved chrome used by PDF/DOCX exporters. */
export type StylePackExportChrome = {
  id: string;
  label: string;
  typography: Required<
    Pick<
      StylePackTypography,
      'bodyFont' | 'headingFont' | 'monoFont' | 'bodyColor' | 'headingColor' | 'mutedColor'
    >
  > &
    StylePackTypography;
  chrome: Required<
    Pick<
      StylePackChrome,
      | 'headerText'
      | 'footerText'
      | 'disclaimer'
      | 'showLogo'
      | 'showCoverBrand'
      | 'showCoverTitle'
      | 'showCoverDetails'
      | 'marginTopMm'
      | 'marginBottomMm'
      | 'marginLeftMm'
      | 'marginRightMm'
    >
  > &
    StylePackChrome;
  logoDataUri: string | null;
  /** Intrinsic pixel size of `logoDataUri` when a logo is present. */
  logoWidthPx: number | null;
  logoHeightPx: number | null;
};

const DEFAULT_TYPOGRAPHY: StylePackExportChrome['typography'] = {
  bodyFont: 'Calibri',
  headingFont: 'Calibri',
  monoFont: 'Consolas',
  bodyColor: '#1A1A1A',
  headingColor: '#111111',
  mutedColor: '#5A6270',
};

const DEFAULT_CHROME: StylePackExportChrome['chrome'] = {
  headerText: '',
  footerText: '{title}',
  disclaimer: '',
  showLogo: true,
  showCoverBrand: true,
  showCoverTitle: true,
  showCoverDetails: true,
  marginTopMm: 14,
  marginBottomMm: 14,
  marginLeftMm: 12,
  marginRightMm: 12,
};

export function blankPublicStylePack(): PublicStylePack {
  return {
    id: BLANK_STYLE_PACK_ID,
    organizationId: null,
    slug: 'blank',
    label: 'Blank',
    status: 'active',
    formats: ['pdf', 'docx'],
    typography: {},
    chrome: {},
    hasLogo: false,
    logoContentType: null,
    createdAt: null,
    updatedAt: null,
    builtin: true,
  };
}

export function blankExportChrome(): StylePackExportChrome {
  return {
    id: BLANK_STYLE_PACK_ID,
    label: 'Blank',
    typography: { ...DEFAULT_TYPOGRAPHY },
    chrome: { ...DEFAULT_CHROME, showLogo: false, showCoverBrand: false },
    logoDataUri: null,
    logoWidthPx: null,
    logoHeightPx: null,
  };
}

function asTypography(value: unknown): StylePackTypography {
  const parsed = stylePackTypographySchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function asChrome(value: unknown): StylePackChrome {
  const parsed = stylePackChromeSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function asFormats(value: unknown): StylePackFormat[] {
  if (!Array.isArray(value)) {
    return ['pdf', 'docx'];
  }
  const formats = value.filter(
    (entry): entry is StylePackFormat =>
      entry === 'pdf' || entry === 'docx',
  );
  return formats.length > 0 ? formats : ['pdf', 'docx'];
}

export function toPublicStylePack(
  row: typeof stylePacks.$inferSelect,
): PublicStylePack {
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    label: row.label,
    status: row.status === 'archived' ? 'archived' : 'active',
    formats: asFormats(row.formats),
    typography: asTypography(row.typography),
    chrome: asChrome(row.chrome),
    hasLogo: Boolean(row.logoBlobKey),
    logoContentType: row.logoContentType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    builtin: false,
  };
}

export function slugifyStylePackLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'style-pack'
  );
}

export function isAllowedStylePackLogoType(value: string): boolean {
  return ALLOWED_LOGO_TYPES.has(value);
}

export function stylePackLogoBlobKey(
  organizationId: string,
  packId: string,
  ext: string,
): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
  return blobObjectKey(
    'doc-templates',
    `${organizationId}/${packId}/logo.${safeExt}`,
  );
}

function logoExtFromContentType(contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/webp') return 'webp';
  return 'png';
}

function localLogoPath(uploadDir: string, blobKey: string): string {
  return path.join(uploadDir, blobKey.replace(/^doc-templates\//, ''));
}

export async function writeStylePackLogo(options: {
  uploadDir: string;
  blobKey: string;
  buffer: Buffer;
  contentType: string;
  blobStore?: BlobStore;
}): Promise<void> {
  const { uploadDir, blobKey, buffer, contentType, blobStore } = options;
  // Local first so logos work when S3 is misconfigured (common Dokploy paste:
  // region "auto" without endpoint → s3.auto.amazonaws.com ENOTFOUND).
  const localPath = localLogoPath(uploadDir, blobKey);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, buffer);

  if (blobStore && blobStore.provider !== 'disabled') {
    try {
      await blobStore.put({ key: blobKey, body: buffer, contentType });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'unknown object-store error';
      console.error(
        `[style-packs] blob put failed for ${blobKey}; using local file: ${detail}`,
      );
    }
  }
}

export async function readStylePackLogo(options: {
  uploadDir: string;
  blobKey: string;
  blobStore?: BlobStore;
}): Promise<Buffer | null> {
  const { uploadDir, blobKey, blobStore } = options;
  if (blobStore && blobStore.provider !== 'disabled') {
    try {
      const fromBlob = await blobStore.get(blobKey);
      if (fromBlob) {
        return fromBlob;
      }
    } catch {
      // Fall through to local (broken S3 credentials / DNS, etc.).
    }
  }
  try {
    return await readFile(localLogoPath(uploadDir, blobKey));
  } catch {
    return null;
  }
}

export async function deleteStylePackLogo(options: {
  uploadDir: string;
  blobKey: string;
  blobStore?: BlobStore;
}): Promise<void> {
  const { uploadDir, blobKey, blobStore } = options;
  if (blobStore && blobStore.provider !== 'disabled') {
    await blobStore.delete(blobKey).catch(() => undefined);
  }
  try {
    await unlink(localLogoPath(uploadDir, blobKey));
  } catch {
    // missing is fine
  }
}

export async function listStylePacksForOrganization(
  database: Database,
  organizationId: string,
  options?: { includeArchived?: boolean },
): Promise<PublicStylePack[]> {
  const rows = options?.includeArchived
    ? await database.db
        .select()
        .from(stylePacks)
        .where(eq(stylePacks.organizationId, organizationId))
        .orderBy(asc(stylePacks.label))
    : await database.db
        .select()
        .from(stylePacks)
        .where(
          and(
            eq(stylePacks.organizationId, organizationId),
            eq(stylePacks.status, 'active'),
          ),
        )
        .orderBy(asc(stylePacks.label));

  return rows.map(toPublicStylePack);
}

export async function getStylePackRow(
  database: Database,
  packId: string,
): Promise<typeof stylePacks.$inferSelect | null> {
  const [row] = await database.db
    .select()
    .from(stylePacks)
    .where(eq(stylePacks.id, packId))
    .limit(1);
  return row ?? null;
}

export async function organizationIdForWorkspace(
  database: Database,
  workspaceId: string,
): Promise<string | null> {
  const [row] = await database.db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.organizationId ?? null;
}

export async function resolveExportStylePack(options: {
  database: Database;
  organizationId: string;
  stylePackId: string | undefined | null;
  uploadDir: string;
  blobStore?: BlobStore;
}): Promise<StylePackExportChrome> {
  const requested = options.stylePackId?.trim() || BLANK_STYLE_PACK_ID;
  if (requested === BLANK_STYLE_PACK_ID) {
    return blankExportChrome();
  }

  const row = await getStylePackRow(options.database, requested);
  if (
    !row ||
    row.organizationId !== options.organizationId ||
    row.status !== 'active'
  ) {
    throw new AppError({
      code: 'STYLE_PACK_NOT_FOUND',
      message: 'Style pack not found',
      statusCode: 404,
    });
  }

  const typography = {
    ...DEFAULT_TYPOGRAPHY,
    ...asTypography(row.typography),
  };
  const chrome = {
    ...DEFAULT_CHROME,
    ...asChrome(row.chrome),
  };

  let logoDataUri: string | null = null;
  let logoWidthPx: number | null = null;
  let logoHeightPx: number | null = null;
  const wantsLogo =
    Boolean(row.logoBlobKey) &&
    (chrome.showLogo !== false || chrome.showCoverBrand !== false);
  if (wantsLogo && row.logoBlobKey) {
    const buffer = await readStylePackLogo({
      uploadDir: options.uploadDir,
      blobKey: row.logoBlobKey,
      blobStore: options.blobStore,
    });
    if (buffer) {
      try {
        const prepared = await prepareStylePackLogoForPrint(buffer);
        logoDataUri = prepared.dataUri;
        logoWidthPx = prepared.widthPx;
        logoHeightPx = prepared.heightPx;
      } catch {
        // Fall back to the raw bytes if decoding fails; export still proceeds.
        if (row.logoContentType) {
          logoDataUri = `data:${row.logoContentType};base64,${buffer.toString('base64')}`;
        }
      }
    }
  }

  return {
    id: row.id,
    label: row.label,
    typography,
    chrome,
    logoDataUri,
    logoWidthPx,
    logoHeightPx,
  };
}

export function interpolateStyleTemplate(
  template: string,
  vars: { title: string; page?: string; pages?: string },
): string {
  return template
    .replaceAll('{title}', vars.title)
    .replaceAll('{page}', vars.page ?? '')
    .replaceAll('{pages}', vars.pages ?? '');
}

export function logoContentTypeToExt(contentType: string): string {
  return logoExtFromContentType(contentType);
}
