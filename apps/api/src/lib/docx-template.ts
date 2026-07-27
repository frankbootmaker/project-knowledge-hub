/**
 * Word shell templates for Doc Factory style packs.
 *
 * Uploaded .docx files keep letterhead / headers / footers / styles. At export
 * time the knowledge Markdown (as OOXML) is injected at a marked body anchor:
 * content control or bookmark `PKH_BODY`, or a `{{body}}` placeholder.
 */
import JSZip from 'jszip';
import { AppError } from '@project-knowledge-hub/domain';
import {
  interpolateStyleTemplate,
  type StyleTemplateVars,
} from './style-packs.js';

export const DOCX_BODY_ANCHOR_TAG = 'PKH_BODY';
export const DOCX_BODY_PLACEHOLDER = '{{body}}';
export const DOCX_TEMPLATE_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type DocxBodyAnchor = 'contentControl' | 'bookmark' | 'placeholder';

const CONTENT_TYPES_PART = '[Content_Types].xml';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Detect the body insertion point inside `word/document.xml`. */
export function detectDocxBodyAnchor(documentXml: string): DocxBodyAnchor | null {
  if (
    /<w:tag\b[^>]*\bw:val="PKH_BODY"/i.test(documentXml) ||
    /<w:alias\b[^>]*\bw:val="PKH_BODY"/i.test(documentXml)
  ) {
    return 'contentControl';
  }
  if (/<w:bookmarkStart\b[^>]*\bw:name="PKH_BODY"/i.test(documentXml)) {
    return 'bookmark';
  }
  if (documentXml.includes(DOCX_BODY_PLACEHOLDER)) {
    return 'placeholder';
  }
  return null;
}

export async function validateDocxTemplateBuffer(
  buffer: Buffer,
): Promise<DocxBodyAnchor> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(buffer);
  } catch {
    throw new AppError({
      code: 'STYLE_PACK_DOCX_TEMPLATE_INVALID',
      message: 'The uploaded file is not a valid Word (.docx) package',
      statusCode: 400,
    });
  }

  const documentFile = archive.file('word/document.xml');
  if (!documentFile) {
    throw new AppError({
      code: 'STYLE_PACK_DOCX_TEMPLATE_INVALID',
      message: 'Word template is missing word/document.xml',
      statusCode: 400,
    });
  }

  const documentXml = await documentFile.async('string');
  const anchor = detectDocxBodyAnchor(documentXml);
  if (!anchor) {
    throw new AppError({
      code: 'STYLE_PACK_DOCX_TEMPLATE_NO_BODY',
      message:
        'Word template must contain a PKH_BODY content control or bookmark, or a {{body}} placeholder',
      statusCode: 400,
    });
  }
  return anchor;
}

function interpolateOoxmlTokens(xml: string, vars: StyleTemplateVars): string {
  const escaped: StyleTemplateVars = {
    title: escapeXml(vars.title),
    date: escapeXml(vars.date ?? ''),
    datetime: escapeXml(vars.datetime ?? ''),
    slug: escapeXml(vars.slug ?? ''),
    type: escapeXml(vars.type ?? ''),
    status: escapeXml(vars.status ?? ''),
    page: escapeXml(vars.page ?? ''),
    pages: escapeXml(vars.pages ?? ''),
  };
  return interpolateStyleTemplate(xml, escaped);
}

/** Pull block-level children from a generated document body (no sectPr). */
export function extractBodyBlocks(documentXml: string): string {
  const match = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/i.exec(documentXml);
  if (!match?.[1]) {
    return '';
  }
  return match[1].replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/gi, '').trim();
}

function replaceContentControlBody(
  documentXml: string,
  bodyBlocks: string,
): string {
  let replaced = false;
  const next = documentXml.replace(/<w:sdt\b[\s\S]*?<\/w:sdt>/gi, (block) => {
    if (
      !/<w:tag\b[^>]*\bw:val="PKH_BODY"/i.test(block) &&
      !/<w:alias\b[^>]*\bw:val="PKH_BODY"/i.test(block)
    ) {
      return block;
    }
    replaced = true;
    if (/<w:sdtContent\b[\s\S]*?<\/w:sdtContent>/i.test(block)) {
      return block.replace(
        /<w:sdtContent\b[^>]*>[\s\S]*?<\/w:sdtContent>/i,
        `<w:sdtContent>${bodyBlocks}</w:sdtContent>`,
      );
    }
    return block.replace(
      /<\/w:sdt>/i,
      `<w:sdtContent>${bodyBlocks}</w:sdtContent></w:sdt>`,
    );
  });
  if (!replaced) {
    throw new AppError({
      code: 'STYLE_PACK_DOCX_TEMPLATE_NO_BODY',
      message: 'PKH_BODY content control was not found in the template',
      statusCode: 400,
    });
  }
  return next;
}

function replaceBookmarkBody(documentXml: string, bodyBlocks: string): string {
  const startMatch = /<w:bookmarkStart\b[^>]*\bw:name="PKH_BODY"[^>]*\/>/i.exec(
    documentXml,
  );
  if (!startMatch || startMatch.index === undefined) {
    throw new AppError({
      code: 'STYLE_PACK_DOCX_TEMPLATE_NO_BODY',
      message: 'PKH_BODY bookmark was not found in the template',
      statusCode: 400,
    });
  }
  const idMatch = /\bw:id="(\d+)"/i.exec(startMatch[0]);
  if (!idMatch?.[1]) {
    throw new AppError({
      code: 'STYLE_PACK_DOCX_TEMPLATE_INVALID',
      message: 'PKH_BODY bookmark is missing an id',
      statusCode: 400,
    });
  }
  const endRe = new RegExp(
    `<w:bookmarkEnd\\b[^>]*\\bw:id="${idMatch[1]}"[^>]*/>`,
    'i',
  );
  const rest = documentXml.slice(startMatch.index + startMatch[0].length);
  const endMatch = endRe.exec(rest);
  if (!endMatch || endMatch.index === undefined) {
    throw new AppError({
      code: 'STYLE_PACK_DOCX_TEMPLATE_INVALID',
      message: 'PKH_BODY bookmark end marker is missing',
      statusCode: 400,
    });
  }
  const before = documentXml.slice(0, startMatch.index + startMatch[0].length);
  const after = rest.slice(endMatch.index + endMatch[0].length);
  return `${before}${bodyBlocks}${endMatch[0]}${after}`;
}

function replacePlaceholderBody(
  documentXml: string,
  bodyBlocks: string,
): string {
  const paragraphRe =
    /<w:p\b[^>]*>[\s\S]*?\{\{body\}\}[\s\S]*?<\/w:p>/i;
  if (!paragraphRe.test(documentXml)) {
    // Fallback: raw token replacement if it somehow sits outside a paragraph.
    if (!documentXml.includes(DOCX_BODY_PLACEHOLDER)) {
      throw new AppError({
        code: 'STYLE_PACK_DOCX_TEMPLATE_NO_BODY',
        message: '{{body}} placeholder was not found in the template',
        statusCode: 400,
      });
    }
    return documentXml.replaceAll(DOCX_BODY_PLACEHOLDER, bodyBlocks);
  }
  return documentXml.replace(paragraphRe, bodyBlocks);
}

export function injectBodyIntoDocumentXml(
  documentXml: string,
  bodyBlocks: string,
  anchor: DocxBodyAnchor,
): string {
  switch (anchor) {
    case 'contentControl':
      return replaceContentControlBody(documentXml, bodyBlocks);
    case 'bookmark':
      return replaceBookmarkBody(documentXml, bodyBlocks);
    case 'placeholder':
      return replacePlaceholderBody(documentXml, bodyBlocks);
    default: {
      const _exhaustive: never = anchor;
      return _exhaustive;
    }
  }
}

/**
 * Merge generated body OOXML (+ optional media) into an uploaded Word shell.
 */
export async function mergeHtmlDocxIntoShell(options: {
  templateBuffer: Buffer;
  /** Full html-to-docx package whose body blocks become the shell body. */
  bodyDocxBuffer: Buffer;
  vars: StyleTemplateVars;
  bodyAnchor?: DocxBodyAnchor | null;
}): Promise<Buffer> {
  const template = await JSZip.loadAsync(options.templateBuffer);
  const bodyPackage = await JSZip.loadAsync(options.bodyDocxBuffer);

  const documentFile = template.file('word/document.xml');
  if (!documentFile) {
    throw new AppError({
      code: 'STYLE_PACK_DOCX_TEMPLATE_INVALID',
      message: 'Word template is missing word/document.xml',
      statusCode: 400,
    });
  }

  const bodyDocument = bodyPackage.file('word/document.xml');
  if (!bodyDocument) {
    throw new AppError({
      code: 'STYLE_PACK_DOCX_TEMPLATE_INVALID',
      message: 'Generated body document is missing word/document.xml',
      statusCode: 500,
    });
  }

  let documentXml = await documentFile.async('string');
  const anchor =
    options.bodyAnchor ?? detectDocxBodyAnchor(documentXml);
  if (!anchor) {
    throw new AppError({
      code: 'STYLE_PACK_DOCX_TEMPLATE_NO_BODY',
      message:
        'Word template must contain a PKH_BODY content control or bookmark, or a {{body}} placeholder',
      statusCode: 400,
    });
  }

  // Fill {title}/{date}/… in the shell before inserting the body.
  for (const name of Object.keys(template.files)) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/i.test(name)) {
      continue;
    }
    const file = template.file(name);
    if (!file || file.dir) {
      continue;
    }
    const xml = await file.async('string');
    template.file(name, interpolateOoxmlTokens(xml, options.vars));
  }
  documentXml = interpolateOoxmlTokens(
    await template.file('word/document.xml')!.async('string'),
    options.vars,
  );

  let bodyBlocks = extractBodyBlocks(await bodyDocument.async('string'));
  bodyBlocks = await mergeBodyMediaIntoTemplate({
    template,
    bodyPackage,
    bodyBlocks,
  });

  documentXml = injectBodyIntoDocumentXml(documentXml, bodyBlocks, anchor);
  template.file('word/document.xml', documentXml);

  const parts = Object.values(template.files)
    .filter((file) => !file.dir)
    .map((file) => file.name);
  const ordered = [
    CONTENT_TYPES_PART,
    ...parts.filter((name) => name !== CONTENT_TYPES_PART),
  ];

  const output = new JSZip();
  for (const name of ordered) {
    const file = template.file(name);
    if (!file) {
      continue;
    }
    output.file(name, await file.async('nodebuffer'));
  }

  return output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function mergeBodyMediaIntoTemplate(options: {
  template: JSZip;
  bodyPackage: JSZip;
  bodyBlocks: string;
}): Promise<string> {
  const { template, bodyPackage } = options;
  let bodyBlocks = options.bodyBlocks;

  const mediaFiles = Object.keys(bodyPackage.files).filter(
    (name) => name.startsWith('word/media/') && !bodyPackage.files[name]?.dir,
  );
  if (mediaFiles.length === 0) {
    return bodyBlocks;
  }

  const relsPath = 'word/_rels/document.xml.rels';
  let relsXml =
    (await template.file(relsPath)?.async('string')) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const existingIds = [
    ...relsXml.matchAll(/\bId="(rId\d+)"/g),
  ].map((match) => Number(match[1]!.replace(/^rId/i, '')));
  let nextId = (existingIds.length > 0 ? Math.max(...existingIds) : 0) + 1;

  const bodyRels =
    (await bodyPackage.file(relsPath)?.async('string')) ?? '';
  const bodyRelMap = new Map<string, string>();
  for (const match of bodyRels.matchAll(
    /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/g,
  )) {
    const id = match[1]!;
    const target = match[2]!;
    if (target.startsWith('media/')) {
      bodyRelMap.set(id, target);
    }
  }

  const contentTypesPath = CONTENT_TYPES_PART;
  let contentTypes =
    (await template.file(contentTypesPath)?.async('string')) ?? '';

  for (const [oldId, target] of bodyRelMap) {
    const sourcePath = target.startsWith('word/')
      ? target
      : `word/${target}`;
    const source = bodyPackage.file(sourcePath);
    if (!source) {
      continue;
    }
    const ext = target.split('.').pop()?.toLowerCase() || 'png';
    const newName = `pkh-body-${nextId}.${ext}`;
    const newTarget = `media/${newName}`;
    const newPath = `word/${newTarget}`;
    const newId = `rId${nextId}`;
    nextId += 1;

    template.file(newPath, await source.async('nodebuffer'));
    const rel =
      `<Relationship Id="${newId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${newTarget}"/>`;
    relsXml = relsXml.replace(
      /<\/Relationships>\s*$/i,
      `${rel}</Relationships>`,
    );
    bodyBlocks = bodyBlocks.replaceAll(`r:embed="${oldId}"`, `r:embed="${newId}"`);
    bodyBlocks = bodyBlocks.replaceAll(`r:link="${oldId}"`, `r:link="${newId}"`);

    const overrideMime =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'webp'
            ? 'image/webp'
            : 'image/png';
    if (
      contentTypes &&
      !contentTypes.includes(`PartName="/${newPath}"`)
    ) {
      contentTypes = contentTypes.replace(
        /<\/Types>\s*$/i,
        `<Override PartName="/${newPath}" ContentType="${overrideMime}"/></Types>`,
      );
    }
  }

  template.file(relsPath, relsXml);
  if (contentTypes) {
    template.file(contentTypesPath, contentTypes);
  }
  return bodyBlocks;
}

/** Minimal starter shell with a {{body}} placeholder and sample tokens. */
export async function buildStarterDocxTemplate(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>`,
  );
  zip.file(
    'word/footer1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:r><w:t>{title} · {date}</w:t></w:r>
  </w:p>
</w:ftr>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:r><w:t>Corporate letterhead — replace with your logo and address.</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>{title}</w:t></w:r>
    </w:p>
    <w:sdt>
      <w:sdtPr>
        <w:alias w:val="PKH_BODY"/>
        <w:tag w:val="PKH_BODY"/>
      </w:sdtPr>
      <w:sdtContent>
        <w:p>
          <w:r><w:t>{{body}}</w:t></w:r>
        </w:p>
      </w:sdtContent>
    </w:sdt>
    <w:sectPr>
      <w:footerReference w:type="default" r:id="rId2"/>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"
        w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`,
  );

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
