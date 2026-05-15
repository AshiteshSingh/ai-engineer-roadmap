export interface AudioChapter {
  index: number;
  title: string;
  start_secs: number;
  duration_secs: number;
}

export interface AudioMeta {
  slug: string;
  title: string;
  voice: string;
  duration_secs: number;
  file_size_bytes: number;
  audio_url: string;
  chapters: AudioChapter[];
}

const R2_PUBLIC_DOMAIN = process.env.NEXT_PUBLIC_R2_DOMAIN || process.env.R2_PUBLIC_DOMAIN || "";

export async function getAudioMeta(slug: string): Promise<AudioMeta | null> {
  if (!R2_PUBLIC_DOMAIN) return null;
  try {
    const url = `https://${R2_PUBLIC_DOMAIN}/knowledge/${slug}.json`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
