/**
 * Normalize style-pack logos for PDF/DOCX chrome.
 *
 * Chromium's PDF header/footer templates and html-to-docx both mishandle PNG
 * alpha: transparent pixels become an opaque rectangular patch. Compositing
 * onto white matches the page background and removes that artifact. WebP is
 * also rewritten to PNG for broader Word / pdfkit support.
 */
import sharp from 'sharp';

export type PreparedStylePackLogo = {
  dataUri: string;
  widthPx: number;
  heightPx: number;
};

export async function prepareStylePackLogoForPrint(
  buffer: Buffer,
): Promise<PreparedStylePackLogo> {
  const image = sharp(buffer, { failOn: 'none' }).rotate();
  const meta = await image.metadata();
  const width = meta.width && meta.width > 0 ? meta.width : 1;
  const height = meta.height && meta.height > 0 ? meta.height : 1;

  const png = await image
    .ensureAlpha()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return {
    dataUri: `data:image/png;base64,${png.toString('base64')}`,
    widthPx: width,
    heightPx: height,
  };
}

/** Intrinsic size scaled into a max box, preserving aspect ratio. */
export function fitLogoBox(
  logo: Pick<PreparedStylePackLogo, 'widthPx' | 'heightPx'>,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(
    maxWidth / Math.max(logo.widthPx, 1),
    maxHeight / Math.max(logo.heightPx, 1),
    1,
  );
  return {
    width: Math.max(1, Math.round(logo.widthPx * scale)),
    height: Math.max(1, Math.round(logo.heightPx * scale)),
  };
}

/** `<img>` markup with explicit pixel size for PDF headers / Word chrome. */
export function stylePackLogoImgHtml(options: {
  dataUri: string;
  widthPx?: number | null;
  heightPx?: number | null;
  maxWidth: number;
  maxHeight: number;
  extraStyle?: string;
}): string {
  const sized =
    options.widthPx && options.heightPx
      ? fitLogoBox(
          { widthPx: options.widthPx, heightPx: options.heightPx },
          options.maxWidth,
          options.maxHeight,
        )
      : { width: options.maxWidth, height: options.maxHeight };
  const extra = options.extraStyle ? `;${options.extraStyle}` : '';
  return (
    `<img src="${options.dataUri}" alt="" width="${sized.width}" height="${sized.height}" ` +
    `style="width:${sized.width}px;height:${sized.height}px;border:0;background:transparent;display:inline-block${extra}" />`
  );
}
