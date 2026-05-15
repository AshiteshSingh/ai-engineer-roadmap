"use client";

import { useState } from "react";
import {
  Container,
  Heading,
  Text,
  Box,
  Card,
  Flex,
  Separator,
  Button,
  Checkbox,
  Link as RadixLink,
} from "@radix-ui/themes";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import NextLink from "next/link";
import { useParams } from "next/navigation";
import {
  ALL_IMAGE_ITEMS,
  FLAG_IMAGES,
  ImgItem,
  PHRASES,
  PHRASES_DETAIL_SLUG,
  PHRASES_KEY,
  SLUG,
  STEMA_SHEET_DETAIL_SLUG,
  STEMA_SHEET_KEY,
  SYMBOLS,
  WM_URLS,
} from "./_data";
import {
  canvasToJpgFile,
  composeCardCanvas,
  composePhrasesCanvas,
  composeStemaSheetCanvas,
  DownloadIcon,
  downloadCardAsJpg,
  downloadPhrasesAsJpg,
  downloadStemaSheetAsJpg,
  MailIcon,
  PreviewDialog,
  shareOrDownloadAndMail,
} from "./_canvas";

function GalleryImage({ item }: { item: ImgItem }) {
  const fit = item.fit ?? "contain";
  return (
    <Box
      style={{
        width: "100%",
        height: 240,
        borderRadius: "var(--radius-3)",
        overflow: "hidden",
        background: item.bg ?? "var(--gray-3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.src}
        alt={item.title}
        loading="lazy"
        crossOrigin="anonymous"
        style={{
          width: "100%",
          height: "100%",
          objectFit: fit,
          display: "block",
        }}
      />
    </Box>
  );
}

function SelectionCheckbox({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <Text
      as="label"
      size="1"
      weight="medium"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 2,
        background: "rgba(255,255,255,0.92)",
        borderRadius: "var(--radius-2)",
        padding: "6px 10px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <Flex align="center" gap="2">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onCheckedChange(v === true)}
          aria-label={label}
        />
        {checked ? "Selectat" : "Selectează"}
      </Flex>
    </Text>
  );
}

function GalleryCard({
  item,
  selected,
  onToggle,
  detailHref,
  extraAction,
}: {
  item: ImgItem;
  selected: boolean;
  onToggle: () => void;
  detailHref: string;
  extraAction?: React.ReactNode;
}) {
  return (
    <Card
      style={{
        outline: selected ? "3px solid var(--teal-9)" : undefined,
        outlineOffset: selected ? -2 : undefined,
        transition: "outline-color 120ms",
      }}
    >
      <Flex direction="column" gap="2">
        <Box style={{ position: "relative" }}>
          <NextLink
            href={detailHref}
            style={{ display: "block", textDecoration: "none", color: "inherit" }}
            aria-label={`Deschide pagina pentru ${item.title}`}
          >
            <GalleryImage item={item} />
          </NextLink>
          <SelectionCheckbox
            checked={selected}
            onCheckedChange={onToggle}
            label={`Selectează ${item.title}`}
          />
        </Box>
        <NextLink
          href={detailHref}
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <Text size="3" weight="bold" as="div" style={{ cursor: "pointer" }}>
            {item.title}
          </Text>
        </NextLink>
        <Text size="2" color="gray" as="p">
          {item.caption}
        </Text>
        <PreviewDialog
          title={item.title}
          filename={`slovenia-${SLUG(item.title)}.jpg`}
          compose={() => composeCardCanvas(item)}
          trigger={
            <Button variant="soft" color="teal" mt="1">
              <DownloadIcon size={14} />
              Previzualizare & descărcare JPG
            </Button>
          }
        />
        {extraAction}
      </Flex>
    </Card>
  );
}

function StemaSheetExtraAction({
  selected,
  onToggle,
  detailHref,
}: {
  selected: boolean;
  onToggle: () => void;
  detailHref: string;
}) {
  return (
    <Box
      mt="2"
      style={{
        borderTop: "1px solid var(--gray-4)",
        paddingTop: "var(--space-2)",
      }}
    >
      <Flex align="center" justify="between" gap="2" mb="2" wrap="wrap">
        <NextLink href={detailHref} style={{ textDecoration: "none", color: "inherit" }}>
          <Text size="2" weight="medium" style={{ cursor: "pointer" }}>
            Fișă pentru decupat (10 copii)
          </Text>
        </NextLink>
        <Text
          as="label"
          size="1"
          weight="medium"
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: "pointer", userSelect: "none" }}
        >
          <Flex align="center" gap="2">
            <Checkbox
              checked={selected}
              onCheckedChange={(v) => onToggle && v !== "indeterminate" && onToggle()}
              aria-label="Selectează fișa pentru decupat"
            />
            {selected ? "Selectat" : "Selectează"}
          </Flex>
        </Text>
      </Flex>
      <Text size="1" color="gray" as="p" mb="2">
        O stemă mare sus + 9 mai mici (3×3) jos, pe o singură pagină A4 — pentru
        printat și decupat.
      </Text>
      <PreviewDialog
        title="Stema — fișă pentru decupat"
        filename="slovenia-stema-fisa-decupat.jpg"
        compose={() => composeStemaSheetCanvas()}
        trigger={
          <Button variant="soft" color="teal">
            <DownloadIcon size={14} />
            Previzualizare fișă pentru decupat
          </Button>
        }
      />
    </Box>
  );
}

function PhrasesCard({
  selected,
  onToggle,
  detailHref,
}: {
  selected: boolean;
  onToggle: () => void;
  detailHref: string;
}) {
  return (
    <Card
      style={{
        outline: selected ? "3px solid var(--teal-9)" : undefined,
        outlineOffset: selected ? -2 : undefined,
        transition: "outline-color 120ms",
        position: "relative",
      }}
    >
      <SelectionCheckbox
        checked={selected}
        onCheckedChange={onToggle}
        label="Selectează cardul cu cuvinte de bază"
      />
      <NextLink href={detailHref} style={{ textDecoration: "none", color: "inherit" }}>
        <Heading size="4" mb="2" style={{ cursor: "pointer" }}>
          Cuvinte de bază
        </Heading>
      </NextLink>
      <Text size="1" color="gray" mb="3" as="p">
        De memorat pentru prezentare — repetați cu pronunția:
      </Text>
      <Flex direction="column" gap="2" mb="3">
        {PHRASES.map((p) => (
          <Flex key={p.sl} align="baseline" gap="2" wrap="wrap">
            <Text size="3" weight="bold" style={{ minWidth: 140 }}>
              {p.sl}
            </Text>
            <Text size="2" color="gray">
              {p.ro}
            </Text>
            {p.ipa && (
              <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
                {p.ipa}
              </Text>
            )}
          </Flex>
        ))}
      </Flex>
      <PreviewDialog
        title="Cuvinte de bază"
        filename="slovenia-cuvinte-de-baza.jpg"
        compose={async () => composePhrasesCanvas()}
        trigger={
          <Button variant="soft" color="teal">
            <DownloadIcon size={14} />
            Previzualizare & descărcare JPG
          </Button>
        }
      />
    </Card>
  );
}

export default function SloveniaImagesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "bogdan";

  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);

  const allKeys = [
    ...ALL_IMAGE_ITEMS.map((i) => i.src),
    PHRASES_KEY,
    STEMA_SHEET_KEY,
  ];
  const allSelected = selected.size === allKeys.length && allKeys.length > 0;

  const detailBase = `/coursework/${slug}/slovenia/images`;
  const itemDetailHref = (item: ImgItem) => `${detailBase}/${SLUG(item.title)}`;

  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allKeys));
  };

  const downloadAll = async () => {
    setBulkBusy(true);
    setBulkProgress(0);
    try {
      for (let i = 0; i < ALL_IMAGE_ITEMS.length; i++) {
        await downloadCardAsJpg(ALL_IMAGE_ITEMS[i]!);
        setBulkProgress(i + 1);
        await new Promise((r) => setTimeout(r, 250));
      }
      await downloadPhrasesAsJpg();
      setBulkProgress(ALL_IMAGE_ITEMS.length + 1);
      await new Promise((r) => setTimeout(r, 250));
      await downloadStemaSheetAsJpg();
      setBulkProgress(ALL_IMAGE_ITEMS.length + 2);
    } finally {
      setBulkBusy(false);
    }
  };

  const sendSelected = async () => {
    if (selected.size === 0) return;
    setSending(true);
    setSendErr(null);
    setSendStatus(null);
    setSendProgress(0);
    try {
      const keys = selected;
      const files: File[] = [];
      let i = 0;
      for (const item of ALL_IMAGE_ITEMS) {
        if (!keys.has(item.src)) continue;
        const canvas = await composeCardCanvas(item);
        files.push(
          await canvasToJpgFile(canvas, `slovenia-${SLUG(item.title)}.jpg`),
        );
        i += 1;
        setSendProgress(i);
      }
      if (keys.has(PHRASES_KEY)) {
        const canvas = composePhrasesCanvas();
        files.push(await canvasToJpgFile(canvas, "slovenia-cuvinte-de-baza.jpg"));
        i += 1;
        setSendProgress(i);
      }
      if (keys.has(STEMA_SHEET_KEY)) {
        const canvas = await composeStemaSheetCanvas();
        files.push(await canvasToJpgFile(canvas, "slovenia-stema-fisa-decupat.jpg"));
        i += 1;
        setSendProgress(i);
      }
      const result = await shareOrDownloadAndMail(files);
      if (result === "shared") {
        setSendStatus(`${files.length} fișier${files.length === 1 ? "" : "e"} trimis${files.length === 1 ? "" : "e"} prin share.`);
      } else if (result === "fallback") {
        setSendStatus(`${files.length} fișier${files.length === 1 ? "" : "e"} descărcat${files.length === 1 ? "" : "e"} — atașați-le în clientul de email care s-a deschis.`);
      } else {
        setSendStatus("Trimitere anulată.");
      }
    } catch (e) {
      setSendErr((e as Error).message ?? "Trimitere eșuată");
    } finally {
      setSending(false);
    }
  };

  const totalCount = ALL_IMAGE_ITEMS.length + 2;

  return (
    <Container size="3" py="8" className="cw-container">
      <Flex align="center" gap="2" mb="4">
        <RadixLink asChild color="gray" size="2">
          <NextLink href={`/coursework/${slug}/slovenia`}>
            <Flex align="center" gap="1">
              <ArrowLeftIcon /> Slovenia
            </Flex>
          </NextLink>
        </RadixLink>
      </Flex>

      <Heading size="8" mb="2">
        Galerie imagini — Slovenia
      </Heading>
      <Text color="gray" size="3" mb="2" as="p">
        Imagini de referință de înaltă calitate pentru standul Slovenia: steag,
        simboluri și limbă.
      </Text>
      <Text color="gray" size="2" mb="4" as="p">
        Apăsați pe imagine sau titlu pentru a deschide pagina dedicată cu
        imaginea mărită. Pe pagina dedicată găsiți și butonul de descărcare
        JPG (A4, 2480×3508 px, 300dpi). Sau bifați mai multe carduri și
        folosiți bara din partea de jos pentru a le trimite pe email
        dintr-un singur pas.
      </Text>

      <Flex gap="3" align="center" mb="6" wrap="wrap">
        <Button
          variant="solid"
          color="teal"
          size="3"
          onClick={downloadAll}
          disabled={bulkBusy}
        >
          <DownloadIcon size={16} />
          {bulkBusy
            ? `Se generează… (${bulkProgress}/${totalCount})`
            : `Descarcă toate cardurile (${totalCount} JPG-uri)`}
        </Button>
        <Text size="1" color="gray">
          Browser-ul va cere o singură dată permisiunea pentru descărcări multiple — acceptați.
        </Text>
      </Flex>

      <Heading size="5" mb="3" mt="2">
        Steag și stemă
      </Heading>
      <Box
        mb="6"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "var(--space-4)",
        }}
      >
        {FLAG_IMAGES.map((item) => (
          <GalleryCard
            key={item.src}
            item={item}
            selected={selected.has(item.src)}
            onToggle={() => toggleOne(item.src)}
            detailHref={itemDetailHref(item)}
            extraAction={
              item.src === WM_URLS.coat ? (
                <StemaSheetExtraAction
                  selected={selected.has(STEMA_SHEET_KEY)}
                  onToggle={() => toggleOne(STEMA_SHEET_KEY)}
                  detailHref={`${detailBase}/${STEMA_SHEET_DETAIL_SLUG}`}
                />
              ) : undefined
            }
          />
        ))}
      </Box>

      <Separator size="4" my="5" />

      <Heading size="5" mb="3">
        Simboluri
      </Heading>
      <Text color="gray" size="2" mb="4" as="p">
        Cele mai recunoscute simboluri ale Sloveniei. Alegeți 1–2 ca element
        central al standului (recomandare: dragonul + Triglav).
      </Text>
      <Box
        mb="6"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "var(--space-4)",
        }}
      >
        {SYMBOLS.map((item) => (
          <GalleryCard
            key={item.src}
            item={item}
            selected={selected.has(item.src)}
            onToggle={() => toggleOne(item.src)}
            detailHref={itemDetailHref(item)}
          />
        ))}
      </Box>

      <Separator size="4" my="5" />

      <Heading size="5" mb="3">
        Limba slovenă
      </Heading>
      <Text color="gray" size="2" mb="4" as="p">
        Slovena este o limbă slavă de sud, cu o particularitate rară: are{" "}
        <strong>formă duală</strong> (pentru exact 2 persoane sau obiecte), pe
        lângă singular și plural. Alfabetul are <strong>25 de litere</strong>:
        a, b, c, č, d, e, f, g, h, i, j, k, l, m, n, o, p, r, s, š, t, u, v, z,
        ž (lipsesc q, w, x, y; apar în plus č, š, ž).
      </Text>

      <Box
        mb="5"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "var(--space-4)",
        }}
      >
        <PhrasesCard
          selected={selected.has(PHRASES_KEY)}
          onToggle={() => toggleOne(PHRASES_KEY)}
          detailHref={`${detailBase}/${PHRASES_DETAIL_SLUG}`}
        />
      </Box>

      <Separator size="4" my="5" />

      <Text size="1" color="gray" as="p">
        Imagini: Wikimedia Commons (licență Creative Commons / domeniu public).
        Format JPG / PNG, servite de pe upload.wikimedia.org.
      </Text>

      <Box style={{ height: 120 }} />

      <Box
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: "var(--space-6)",
          marginLeft: "calc(-1 * var(--container-padding-x, 0px))",
          marginRight: "calc(-1 * var(--container-padding-x, 0px))",
          background: "rgba(255,255,255,0.96)",
          backdropFilter: "saturate(140%) blur(8px)",
          borderTop: "1px solid var(--gray-5)",
          boxShadow: "0 -4px 16px rgba(0,0,0,0.06)",
          padding: "12px 16px",
          zIndex: 5,
        }}
      >
        <Flex align="center" gap="3" wrap="wrap" justify="between">
          <Flex align="center" gap="3" wrap="wrap">
            <Text as="label" size="2" weight="medium" style={{ cursor: "pointer", userSelect: "none" }}>
              <Flex align="center" gap="2">
                <Checkbox
                  checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                  onCheckedChange={() => toggleAll()}
                  aria-label={allSelected ? "Deselectează tot" : "Selectează tot"}
                />
                {allSelected ? "Deselectează tot" : "Selectează tot"}
              </Flex>
            </Text>
            <Text size="2" color="gray">
              {selected.size} din {totalCount} selectate
            </Text>
            {sending && (
              <Text size="2" color="gray">
                · Se generează… ({sendProgress}/{selected.size})
              </Text>
            )}
            {sendStatus && !sending && (
              <Text size="2" color="green">
                · {sendStatus}
              </Text>
            )}
            {sendErr && !sending && (
              <Text size="2" color="red">
                · {sendErr}
              </Text>
            )}
          </Flex>
          <Flex gap="2" wrap="wrap">
            {selected.size > 0 && (
              <Button
                variant="soft"
                color="gray"
                onClick={() => {
                  setSelected(new Set());
                  setSendStatus(null);
                  setSendErr(null);
                }}
                disabled={sending}
              >
                Curăță selecția
              </Button>
            )}
            <Button
              variant="solid"
              color="teal"
              size="3"
              onClick={sendSelected}
              disabled={sending || selected.size === 0}
            >
              <MailIcon size={16} />
              {sending
                ? "Se generează…"
                : `Trimite pe email (${selected.size})`}
            </Button>
          </Flex>
        </Flex>
      </Box>
    </Container>
  );
}
