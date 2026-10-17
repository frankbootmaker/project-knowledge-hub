const KNOWN_IMAGE_PREFIX = 'image/';

export function isImageContentType(contentType: string): boolean {
  return contentType.trim().toLowerCase().startsWith(KNOWN_IMAGE_PREFIX);
}

export function mediaAbsoluteUrl(url: string): string {
  if (typeof window === 'undefined') return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${window.location.origin}${url}`;
}
