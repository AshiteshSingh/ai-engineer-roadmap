import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resumeData } from "@ai-apps/resume";
import "./resume.css";

const SLUGS: Record<string, typeof resumeData> = {
  vadim: resumeData,
};

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = SLUGS[slug];
  if (!data) return {};
  return {
    title: `${data.basics.name} — ${data.basics.label}`,
    description: data.basics.summary,
  };
}

export default async function ResumePdfPage({ params }: Props) {
  const { slug } = await params;
  const data = SLUGS[slug];
  if (!data) notFound();

  const pdfUrl = `/api/resume-pdf/${slug}`;

  return (
    <div className="resume-pdf-page">
      <div className="resume-pdf-toolbar">
        <div className="resume-pdf-title">
          <h1>{data.basics.name}</h1>
          <span>{data.basics.label}</span>
        </div>
        <a
          href={pdfUrl}
          download={`${slug}-resume.pdf`}
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
