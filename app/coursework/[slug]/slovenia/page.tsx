"use client";

import {
  Container,
  Heading,
  Text,
  Box,
  Card,
  Badge,
  Flex,
  Separator,
  Avatar,
  Link as RadixLink,
  Callout,
} from "@radix-ui/themes";
import {
  ArrowLeftIcon,
  CalendarIcon,
  ClockIcon,
  StarIcon,
  InfoCircledIcon,
} from "@radix-ui/react-icons";
import NextLink from "next/link";
import { useParams } from "next/navigation";

const SCHOOL = {
  child: "Bogdan Nicolai",
  className: "Clasa Aventurierilor — clasa I",
  school: "Școala Primară Româno-Finlandeză ERI Brașov",
  parents: ["Vadim Nicolai", "Elena Nicolai"],
};

const EVENT = {
  title: "Ziua Europei",
  country: "Slovenia",
  flag: "🇸🇮",
  date: "Joi, 7 Mai 2026",
  time: "14:00 — 16:00",
  setupTime: "13:30",
  rsvpDeadline: "Mie, 29 Apr. 2026 @ 23:00",
  location: "Școala ERI Brașov",
  price: "GRATUIT",
  group: "Clasa Aventurierilor — clasa I",
  organizer: "Profesori ERI",
};

const TEAM_SLOVENIA = [
  { name: "Bogdan Nicolai", isOurChild: true },
  { name: "Iunia Tuca" },
  { name: "Iustin Tuca" },
  { name: "Elina Pantelimon" },
];

const TODOS = [
  "Luați legătura cu colegii din echipă (Iunia, Iustin, Elina) și organizați o întâlnire (puteți solicita un spațiu în școală, cu anunț prealabil).",
  "Realizați o ștampilă reprezentativă pentru Slovenia.",
  "Pregătiți materialele (afișe, decor, elemente vizuale).",
  "Pregătiți o prezentare de aproximativ 3 minute, susținută pe rând de câte 2 elevi.",
  "Asigurați-vă că informația esențială despre Slovenia nu lipsește din prezentare.",
];

const STAND_IDEAS = [
  "Prezentarea unor informații despre Slovenia",
  "Realizarea unui afiș sau poster",
  "Expunerea de obiecte, produse sau simboluri reprezentative",
  "Degustarea de produse alimentare (achiziționate din comerț, pentru siguranță)",
  "Audiții muzicale",
  "Prezentarea de dansuri tradiționale sau costume",
];

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function SloveniaEventPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "bogdan";

  return (
    <Container size="3" py="8" className="cw-container">
      {/* Breadcrumb */}
      <Flex align="center" gap="2" mb="4">
        <RadixLink asChild color="gray" size="2">
          <NextLink href={`/coursework/${slug}`}>
            <Flex align="center" gap="1">
              <ArrowLeftIcon /> {SCHOOL.child}
            </Flex>
          </NextLink>
        </RadixLink>
      </Flex>

      {/* School / child header */}
      <Card mb="5">
        <Flex align="center" gap="3">
          <Avatar size="4" fallback={initials(SCHOOL.child)} radius="full" color="teal" />
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size="4" weight="bold" as="div">
              {SCHOOL.child}
            </Text>
            <Text size="2" color="gray" as="div">
              {SCHOOL.className} · {SCHOOL.school}
            </Text>
            <Text size="1" color="gray" as="div" mt="1">
              Părinți: {SCHOOL.parents.join(" & ")}
            </Text>
          </Box>
        </Flex>
      </Card>

      {/* Event title */}
      <Flex align="center" gap="3" mb="2">
        <Text size="9">{EVENT.flag}</Text>
        <Box>
          <Heading size="8" mb="1">
            {EVENT.title} — {EVENT.country}
          </Heading>
          <Flex gap="2" wrap="wrap">
            <Badge size="2" color="teal" variant="soft">
              <CalendarIcon /> {EVENT.date}
            </Badge>
            <Badge size="2" color="teal" variant="soft">
              <ClockIcon /> {EVENT.time}
            </Badge>
            <Badge size="2" color="green" variant="soft">
              {EVENT.price}
            </Badge>
          </Flex>
        </Box>
      </Flex>

      <Text color="gray" size="2" mb="5" as="p">
        Organizator: {EVENT.organizer} · Grupă: {EVENT.group}
      </Text>

      {/* RSVP deadline callout */}
      <Callout.Root color="amber" mb="5">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          <strong>Deadline RSVP:</strong> {EVENT.rsvpDeadline}. Pregătirea standurilor începe la{" "}
          <strong>{EVENT.setupTime}</strong>; prezentările pornesc la <strong>14:00</strong>.
        </Callout.Text>
      </Callout.Root>

      {/* Team Slovenia — highlighted */}
      <Card mb="5" style={{ borderColor: "var(--teal-7)" }}>
        <Flex align="center" gap="2" mb="3">
          <StarIcon color="var(--teal-9)" />
          <Heading size="4">Echipa Slovenia</Heading>
        </Flex>
        <Flex direction="column" gap="2">
          {TEAM_SLOVENIA.map((m) => (
            <Flex key={m.name} align="center" gap="3">
              <Avatar
                size="2"
                fallback={initials(m.name)}
                radius="full"
                color={m.isOurChild ? "teal" : "gray"}
              />
              <Text size="3" weight={m.isOurChild ? "bold" : "regular"}>
                {m.name}
              </Text>
              {m.isOurChild && (
                <Badge size="1" color="teal" variant="solid">
                  copilul nostru
                </Badge>
              )}
            </Flex>
          ))}
        </Flex>
      </Card>

      {/* TODOs for Slovenia team */}
      <Card mb="5">
        <Heading size="4" mb="3">
          De pregătit pentru standul Slovenia
        </Heading>
        <Flex direction="column" gap="2" asChild>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            {TODOS.map((t, i) => (
              <li key={i}>
                <Text size="2">{t}</Text>
              </li>
            ))}
          </ol>
        </Flex>
        <Separator size="4" my="4" />
        <Text size="2" weight="medium" mb="2" as="div">
          Idei pentru organizarea standului:
        </Text>
        <Flex direction="column" gap="1" asChild>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {STAND_IDEAS.map((s) => (
              <li key={s}>
                <Text size="2" color="gray">
                  {s}
                </Text>
              </li>
            ))}
          </ul>
        </Flex>
      </Card>

      {/* Link to full guide */}
      <Card mb="3" asChild style={{ borderColor: "var(--teal-7)", cursor: "pointer" }}>
        <NextLink href={`/coursework/${slug}/slovenia/ideas`}>
          <Flex align="center" gap="3">
            <Box style={{ fontSize: 32 }}>📘</Box>
            <Box style={{ flex: 1 }}>
              <Flex align="center" gap="2">
                <StarIcon color="var(--teal-9)" />
                <Heading size="4">Ghid complet de pregătire</Heading>
              </Flex>
              <Text size="2" color="gray" as="p" mt="1">
                13 secțiuni cu idei pentru stand: concept, ștampilă, afiș, decor 3D, degustare, muzică, costume, activități interactive, script prezentare, logistică, checklist ziua Z.
              </Text>
            </Box>
            <Text size="2" color="teal" weight="medium">
              Deschide →
            </Text>
          </Flex>
        </NextLink>
      </Card>

      {/* Link to image gallery */}
      <Card mb="5" asChild style={{ borderColor: "var(--teal-7)", cursor: "pointer" }}>
        <NextLink href={`/coursework/${slug}/slovenia/images`}>
          <Flex align="center" gap="3">
            <Box style={{ fontSize: 32 }}>🖼️</Box>
            <Box style={{ flex: 1 }}>
              <Flex align="center" gap="2">
                <StarIcon color="var(--teal-9)" />
                <Heading size="4">Galerie imagini</Heading>
              </Flex>
              <Text size="2" color="gray" as="p" mt="1">
                Steag, simboluri (dragon, Triglav, Bled, licitar, albine, Lipițani, proteu) și limba slovenă — referințe vizuale de înaltă calitate.
              </Text>
            </Box>
            <Text size="2" color="teal" weight="medium">
              Deschide →
            </Text>
          </Flex>
        </NextLink>
      </Card>

      {/* Full description */}
      <Card mb="5">
        <Heading size="4" mb="3">
          Descriere eveniment
        </Heading>
        <Text size="2" as="p" mb="2">
          Dragi părinți, avem plăcerea să vă invităm la un eveniment special dedicat Zilei Europei,
          care va avea loc pe <strong>7 mai 2026, ora 14:00</strong>. Activitatea celebrează
          diversitatea și frumusețea Uniunii Europene, oferindu-le copiilor ocazia de a explora,
          învăța și experimenta lucruri noi.
        </Text>
        <Text size="2" as="p" mb="2">
          Pregătirea standurilor, alături de părinți, începe la <strong>13:30</strong>, pentru o
          desfășurare eficientă. Elevii și părinții vor lucra în echipe pentru a prezenta țara
          europeană repartizată — în cazul nostru, <strong>Slovenia</strong>. Părinții au rol de
          ghidaj și sprijin; prezentarea standului trebuie realizată exclusiv de către copii.
        </Text>
        <Text size="2" as="p" mb="2">
          Anul acesta echipele includ colegi din alte clase. În ziua evenimentului, fiecare elev
          primește un <em>„Pașaport pentru Europa”</em> și un <em>„Jurnal de călătorie”</em>,
          vizitează standurile și colectează ștampile (după participarea la prezentare). Este
          necesară vizitarea a minimum <strong>8 țări</strong>.
        </Text>
        <Text size="2" as="p" color="gray">
          Important: nu lăsați pregătirea pe ultimul moment.
        </Text>
      </Card>

      {/* Source comment */}
      <Card>
        <Flex align="center" gap="2" mb="2">
          <Avatar size="1" fallback="LO" radius="full" color="gray" />
          <Box>
            <Text size="2" weight="medium" as="div">
              Luiza Oprea
            </Text>
            <Text size="1" color="gray">
              22 apr. 2026, 14:48
            </Text>
          </Box>
        </Flex>
        <Text size="1" color="gray">
          Sursa repartizării echipelor pe țări (mesaj din portalul școlii).
        </Text>
      </Card>
    </Container>
  );
}
