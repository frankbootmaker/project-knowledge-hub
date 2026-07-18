import { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize';

/**
 * Allowlist for rendered knowledge HTML.
 * Scripts, event handlers, and javascript: URLs are excluded by rehype-sanitize defaults.
 */
export const knowledgeSanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className'], ['class']],
    pre: [...(defaultSchema.attributes?.pre ?? []), ['className'], ['class']],
    span: [...(defaultSchema.attributes?.span ?? []), ['className'], ['class']],
    a: [...(defaultSchema.attributes?.a ?? []), ['className'], ['class'], ['target'], ['rel']],
    h1: [...(defaultSchema.attributes?.h1 ?? []), ['id']],
    h2: [...(defaultSchema.attributes?.h2 ?? []), ['id']],
    h3: [...(defaultSchema.attributes?.h3 ?? []), ['id']],
    h4: [...(defaultSchema.attributes?.h4 ?? []), ['id']],
    h5: [...(defaultSchema.attributes?.h5 ?? []), ['id']],
    h6: [...(defaultSchema.attributes?.h6 ?? []), ['id']],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'http', 'https', 'mailto'],
  },
};
