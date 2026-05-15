/**
 * Simple HTML Sanitizer
 *
 * Uses DOMParser on the client and regex-based sanitization on the server.
 */

export function sanitizeHtml(html: string): string {
  if (!html) return '';

  if (typeof window === 'undefined') {
    return sanitizeHtmlBasic(html);
  }

  return sanitizeHtmlClient(html);
}

function sanitizeHtmlClient(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  doc.querySelectorAll('script').forEach((el) => el.remove());
  doc.querySelectorAll('style').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    });
  });
  doc.querySelectorAll('script, style, iframe, object, embed, form, input, button')
    .forEach((el) => el.remove());

  return doc.body.innerHTML;
}

function sanitizeHtmlBasic(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/\s+src\s*=\s*["']data:[^"']*["']/gi, ' src=""');
}
