// Typeform reads `#key=value&key=value` as hidden-field values — this is
// Typeform's hidden-fields syntax, not a URL query string.

export function withTypeformHiddenFields(
  baseUrl: string,
  fields: Record<string, string | undefined | null>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v) params.set(k, v);
  }
  const tail = params.toString();
  if (!tail) return baseUrl;
  const sep = baseUrl.includes("#") ? "&" : "#";
  return `${baseUrl}${sep}${tail}`;
}

export function getApplicationTypeformUrl(opts: {
  applicationId: string;
  audioUrl?: string | null;
}): string | null {
  const base = process.env.TYPEFORM_APPLICATIONS_URL;
  if (!base) return null;
  return withTypeformHiddenFields(base, {
    application_id: opts.applicationId,
    audio_url: opts.audioUrl ?? undefined,
  });
}
