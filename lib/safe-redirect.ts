// Open-redirect guard for post-auth `callbackURL` handling. Returns `raw` only
// when it is a safe, same-origin path ("/foo") — rejects absolute URLs
// ("https://evil.com") and protocol-relative ones ("//evil.com").
export function safeInternalPath(
  raw: string | null | undefined,
  fallback = "/",
): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}
