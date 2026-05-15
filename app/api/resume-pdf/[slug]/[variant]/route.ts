export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; variant: string }> }
) {
  const { slug, variant } = await params;

  const { renderResumePdf } = await import("@ai-apps/resume/render");
  const pdf = await renderResumePdf(slug, variant);

  if (!pdf) {
    return new Response("Resume not found", { status: 404 });
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${slug}-${variant}-resume.pdf"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
