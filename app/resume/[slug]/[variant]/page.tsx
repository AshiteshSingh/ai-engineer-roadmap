import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { VARIANTS } from "@ai-apps/resume";
import "../resume.css";

type Props = { params: Promise<{ slug: string; variant: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, variant } = await params;
  const data = VARIANTS[slug]?.[variant];
  if (!data) return {};
  return {
    title: `${data.basics.name} — ${data.basics.label}`,
    description: data.basics.summary,
  };
}

export default async function ResumeVariantPdfPage({ params }: Props) {
  const { slug, variant } = await params;
  const data = VARIANTS[slug]?.[variant];
  if (!data) notFound();

  const pdfUrl = `/api/resume-pdf/${slug}/${variant}`;

  return (
    <div className="resume-pdf-page">
      <div className="resume-pdf-toolbar">
        <div className="resume-pdf-title">
          <h1>{data.basics.name}</h1>
          <span>{data.basics.label}</span>
        </div>
        <a
          href={pdfUrl}
          download={`${slug}-${variant}-resume.pdf`}
          className="resume-pdf-download"
        >
          Download PDF
        </a>
      </div>
      <iframe
        src={pdfUrl}
        className="resume-pdf-viewer"
        title={`${data.basics.name} Resume`}
      />
    </div>
  );
}
