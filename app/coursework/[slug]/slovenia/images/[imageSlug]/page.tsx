"use client";

import {
  Box,
  Button,
  Flex,
  Heading,
  Link as RadixLink,
  Text,
} from "@radix-ui/themes";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@radix-ui/react-icons";
import NextLink from "next/link";
import { useParams } from "next/navigation";
import {
  ALL_DETAIL_SLUGS,
  ALL_IMAGE_ITEMS,
  findItemBySlug,
  PHRASES,
  PHRASES_DETAIL_SLUG,
  SLUG,
  STEMA_SHEET_DETAIL_SLUG,
} from "../_data";
import {
  composeCardCanvas,
  composePhrasesCanvas,
  composeStemaSheetCanvas,
  DownloadIcon,
  PreviewDialog,
  triggerDownload,
} from "../_canvas";
import { Section, Heading as DSHeading } from "@/components/ui";
import styles from "./page.module.css";

function navTitle(detailSlug: string): string {
  if (detailSlug === PHRASES_DETAIL_SLUG) return "Cuvinte de bază";
  if (detailSlug === STEMA_SHEET_DETAIL_SLUG) return "Stema — fișă pentru decupat";
  const found = ALL_IMAGE_ITEMS.find((i) => SLUG(i.title) === detailSlug);
  return found?.title ?? detailSlug;
}

export default function SloveniaSingleImagePage() {
  const params = useParams<{ slug: string; imageSlug: string }>();
  const courseSlug = params?.slug ?? "bogdan";
  const imageSlug = params?.imageSlug ?? "";

  const galleryHref = `/coursework/${courseSlug}/slovenia/images`;
  const detailHrefFor = (s: string) => `${galleryHref}/${s}`;

  const found = findItemBySlug(imageSlug);

  if (!found) {
    return (
      <Section className="cw-container">
        <Flex align="center" gap="2" mb="4">
          <RadixLink asChild color="gray" size="2">
            <NextLink href={galleryHref}>
              <Flex align="center" gap="1">
                <ArrowLeftIcon /> Galerie
              </Flex>
            </NextLink>
          </RadixLink>
        </Flex>
        <Heading size="6" mb="2">
          Imagine inexistentă
        </Heading>
        <Text color="gray" size="3" as="p">
          Nu am găsit nicio imagine cu acest slug. Întoarceți-vă la galerie pentru a alege alta.
        </Text>
      </Section>
    );
  }

  const idxInAll = ALL_DETAIL_SLUGS.indexOf(imageSlug);
  const prevSlug = idxInAll > 0 ? ALL_DETAIL_SLUGS[idxInAll - 1] : null;
  const nextSlug =
    idxInAll >= 0 && idxInAll < ALL_DETAIL_SLUGS.length - 1
      ? ALL_DETAIL_SLUGS[idxInAll + 1]
      : null;

  return (
    <Section className="cw-container">
      <Flex align="center" gap="2" mb="4" justify="between" wrap="wrap">
        <RadixLink asChild color="gray" size="2">
          <NextLink href={galleryHref}>
            <Flex align="center" gap="1">
              <ArrowLeftIcon /> Galerie Slovenia
            </Flex>
          </NextLink>
        </RadixLink>
        <Flex gap="2">
          {prevSlug && (
            <Button asChild variant="soft" color="gray" size="2">
              <NextLink href={detailHrefFor(prevSlug)}>
                <ChevronLeftIcon /> {navTitle(prevSlug)}
              </NextLink>
            </Button>
          )}
          {nextSlug && (
            <Button asChild variant="soft" color="gray" size="2">
              <NextLink href={detailHrefFor(nextSlug)}>
                {navTitle(nextSlug)} <ChevronRightIcon />
              </NextLink>
            </Button>
          )}
        </Flex>
      </Flex>

      {found.kind === "image" && (
        <ImageDetailContent
          src={found.item.src}
          title={found.item.title}
          caption={found.item.caption}
          fit={found.item.fit}
          bg={found.item.bg}
          composeCanvas={() => composeCardCanvas(found.item)}
          downloadFilename={`slovenia-${SLUG(found.item.title)}.jpg`}
        />
      )}

      {found.kind === "phrases" && <PhrasesDetailContent />}

      {found.kind === "stema_sheet" && <StemaSheetDetailContent />}
    </Section>
  );
}

function ImageDetailContent({
  src,
  title,
  caption,
  fit,
  bg,
  composeCanvas,
  downloadFilename,
}: {
  src: string;
  title: string;
  caption: string;
  fit?: "cover" | "contain";
  bg?: string;
  composeCanvas: () => Promise<HTMLCanvasElement>;
  downloadFilename: string;
}) {
  return (
    <>
      <DSHeading as="h1" size="xl">
        {title}
      </DSHeading>
      <Box
        mb="4"
        className={styles.imgFrame}
        style={bg ? ({ "--frame-bg": bg } as React.CSSProperties) : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={title}
          crossOrigin="anonymous"
          className={styles.img}
          style={{ "--fit": fit ?? "contain" } as React.CSSProperties}
        />
      </Box>
      <Text size="3" color="gray" as="p" mb="5">
        {caption}
      </Text>
      <Flex gap="3" wrap="wrap" mb="6">
        <PreviewDialog
          title={title}
          filename={downloadFilename}
          compose={composeCanvas}
          trigger={
            <Button variant="solid" color="teal" size="3">
              <DownloadIcon size={16} />
              Previzualizare & descărcare JPG (A4)
            </Button>
          }
        />
        <Button
          variant="soft"
          color="gray"
          size="3"
          onClick={async () => {
            const canvas = await composeCanvas();
            triggerDownload(canvas, downloadFilename);
          }}
        >
          <DownloadIcon size={16} />
          Descarcă direct (fără previzualizare)
        </Button>
      </Flex>
      <Text size="1" color="gray" as="p">
        Imagine sursă servită de pe upload.wikimedia.org / images.unsplash.com.
        Format JPG / PNG, licență Creative Commons / Unsplash License.
      </Text>
    </>
  );
}

function PhrasesDetailContent() {
  return (
    <>
      <DSHeading as="h1" size="xl">
        Cuvinte de bază în slovenă
      </DSHeading>
      <Text size="3" color="gray" as="p" mb="4">
        De memorat pentru prezentare — repetați cu pronunția:
      </Text>
      <Box
        mb="5"
        p="4"
        className={styles.panel}
      >
        <Flex direction="column" gap="3">
          {PHRASES.map((p) => (
            <Flex key={p.sl} align="baseline" gap="3" wrap="wrap">
              <Text size="5" weight="bold" className={styles.phraseSl}>
                {p.sl}
              </Text>
              <Text size="4">{p.ro}</Text>
              {p.ipa && (
                <Text size="2" color="gray" className={styles.ipa}>
                  {p.ipa}
                </Text>
              )}
            </Flex>
          ))}
        </Flex>
      </Box>
      <Flex gap="3" wrap="wrap">
        <PreviewDialog
          title="Cuvinte de bază"
          filename="slovenia-cuvinte-de-baza.jpg"
          compose={async () => composePhrasesCanvas()}
          trigger={
            <Button variant="solid" color="teal" size="3">
              <DownloadIcon size={16} />
              Previzualizare & descărcare JPG (A4)
            </Button>
          }
        />
        <Button
          variant="soft"
          color="gray"
          size="3"
          onClick={() => {
            const canvas = composePhrasesCanvas();
            triggerDownload(canvas, "slovenia-cuvinte-de-baza.jpg");
          }}
        >
          <DownloadIcon size={16} />
          Descarcă direct
        </Button>
      </Flex>
    </>
  );
}

function StemaSheetDetailContent() {
  return (
    <>
      <DSHeading as="h1" size="xl">
        Stema Sloveniei — fișă pentru decupat
      </DSHeading>
      <Text size="3" color="gray" as="p" mb="4">
        O stemă mare sus + 9 mai mici (3×3) jos, pe o singură pagină A4 — pentru
        printat și decupat. Util la lipirea pe ecusoane sau steaguri mici la
        standul școlii.
      </Text>
      <Flex gap="3" wrap="wrap">
        <PreviewDialog
          title="Stema — fișă pentru decupat"
          filename="slovenia-stema-fisa-decupat.jpg"
          compose={() => composeStemaSheetCanvas()}
          trigger={
            <Button variant="solid" color="teal" size="3">
              <DownloadIcon size={16} />
              Previzualizare & descărcare JPG (A4)
            </Button>
          }
        />
        <Button
          variant="soft"
          color="gray"
          size="3"
          onClick={async () => {
            const canvas = await composeStemaSheetCanvas();
            triggerDownload(canvas, "slovenia-stema-fisa-decupat.jpg");
          }}
        >
          <DownloadIcon size={16} />
          Descarcă direct
        </Button>
      </Flex>
    </>
  );
}
