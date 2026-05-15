"use client";

import {
  Container,
  Heading,
  Button,
  Flex,
  Dialog,
  TextField,
  Text,
  Box,
  Card,
  Badge,
  Skeleton,
  IconButton,
  DropdownMenu,
} from "@radix-ui/themes";
import {
  PlusIcon,
  DotsHorizontalIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "@radix-ui/react-icons";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import type { ApplicationStatus, AppData } from "@/components/app-detail/types";
import { COLUMNS, NEXT_STATUS, formatDate } from "@/components/app-detail/constants";

// ──────────────────────────────────────────────────────────────────────────────
// Pipeline Funnel Bar
// ──────────────────────────────────────────────────────────────────────────────
function PipelineFunnel({ apps }: { apps: AppData[] }) {
  const counts = Object.fromEntries(COLUMNS.map((c) => [c.status, 0])) as Record<ApplicationStatus, number>;
  for (const app of apps) {
    if (counts[app.status] !== undefined) counts[app.status]++;
  }

  return (
    <Flex gap="2" mb="5" wrap="wrap">
      {COLUMNS.map((col, i) => (
        <Flex key={col.status} align="center" gap="2">
          <Flex
            align="center"
            gap="2"
            px="3"
            py="2"
            style={{
              borderRadius: 8,
              backgroundColor: counts[col.status] > 0 ? `var(--${col.color}-3)` : "var(--gray-2)",
              border: `1px solid var(--${col.color}-6)`,
              opacity: counts[col.status] > 0 ? 1 : 0.5,
            }}
          >
            <Text size="2" weight="medium" color={counts[col.status] > 0 ? col.color : "gray"}>
              {col.label}
            </Text>
            <Badge color={counts[col.status] > 0 ? col.color : "gray"} variant="solid" size="1" radius="full">
              {counts[col.status]}
            </Badge>
          </Flex>
          {i < COLUMNS.length - 1 && (
            <Text size="1" color="gray" style={{ opacity: 0.4 }}>&rsaquo;</Text>
          )}
        </Flex>
      ))}
    </Flex>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Application Row
// ──────────────────────────────────────────────────────────────────────────────
function ApplicationRow({
  app,
  index,
  onMove,
  onReject,
}: {
  app: AppData;
  index: number;
  onMove: (id: string, status: ApplicationStatus) => void;
  onReject: (id: string) => void;
}) {
  const displayTitle = app.position;
  const nextStatus = NEXT_STATUS[app.status];
  const nextLabel = COLUMNS.find((c) => c.status === nextStatus)?.label;

  return (
    <Link
      href={`/applications/${app.slug}`}
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <Flex
        align="center"
        gap="3"
        px="4"
        py="3"
        style={{
          borderTop: index > 0 ? "1px solid var(--gray-5)" : undefined,
          backgroundColor: "var(--color-surface)",
          cursor: "pointer",
          transition: "background-color 0.1s",
        }}
        className="app-row"
      >
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text size="2" weight="medium" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
            {displayTitle}
          </Text>
          <Text size="1" color="gray">
            {app.company} &middot; {formatDate(app.createdAt)}
          </Text>
        </Box>

        <Box onClick={(e) => e.preventDefault()}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton size="1" variant="ghost" color="gray">
                <DotsHorizontalIcon />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content size="1">
              {nextStatus && nextLabel && (
                <DropdownMenu.Item onClick={() => onMove(app.slug, nextStatus)}>
                  <ArrowRightIcon />
                  Move to {nextLabel}
                </DropdownMenu.Item>
              )}
              {app.status !== "rejected" && (
                <DropdownMenu.Item color="red" onClick={() => onReject(app.slug)}>
                  Mark Rejected
                </DropdownMenu.Item>
              )}
              {app.status === "rejected" && (
                <DropdownMenu.Item onClick={() => onMove(app.slug, "saved")}>
                  Restore to Saved
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Box>
      </Flex>
    </Link>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Status Section (collapsible group)
// ──────────────────────────────────────────────────────────────────────────────
function StatusSection({
  column,
  apps,
  onMove,
  onReject,
  defaultOpen = true,
}: {
  column: (typeof COLUMNS)[number];
  apps: AppData[];
  onMove: (id: string, status: ApplicationStatus) => void;
  onReject: (id: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Box mb="3">
      <Flex
        align="center"
        gap="2"
        px="3"
        py="2"
        onClick={() => setOpen((v) => !v)}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        <Box style={{ color: "var(--gray-9)", flexShrink: 0 }}>
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Box>
        <Badge color={column.color} variant="soft" size="2">
          {column.label}
        </Badge>
        <Text size="1" color="gray">
          {apps.length} {apps.length === 1 ? "application" : "applications"}
        </Text>
      </Flex>

      {open && apps.length > 0 && (
        <Box style={{ border: "1px solid var(--gray-5)", borderRadius: 8, overflow: "hidden", marginLeft: 6 }}>
          {apps.map((app, i) => (
            <ApplicationRow
              key={app.id}
              app={app}
              index={i}
              onMove={onMove}
              onReject={onReject}
            />
          ))}
        </Box>
      )}

      {open && apps.length === 0 && (
        <Flex
          align="center"
          justify="center"
          py="4"
          style={{
            border: "1px dashed var(--gray-5)",
            borderRadius: 8,
            backgroundColor: "var(--gray-1)",
          }}
        >
          <Text size="1" color="gray">
            Nothing here yet
          </Text>
        </Flex>
      )}
    </Box>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Add Application Dialog
// ──────────────────────────────────────────────────────────────────────────────
function AddApplicationDialog({
  onCreated,
}: {
  onCreated: (app: AppData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [position, setPosition] = useState("");
  const [company, setCompany] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!position || !company) return;
    setSaving(true);
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position,
          company,
          url: url || null,
        }),
      });
      if (res.ok) {
        const row = await res.json();
        onCreated(row);
        setOpen(false);
        setUrl("");
        setPosition("");
        setCompany("");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <Button size="2">
          <PlusIcon /> Add
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="440px">
        <Dialog.Title>Track a Job</Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          Add a job application to your pipeline.
        </Dialog.Description>
        <form onSubmit={handleSubmit}>
          <Flex direction="column" gap="3">
            <label>
              <Text size="2" weight="medium" mb="1" as="div">
                Position *
              </Text>
              <TextField.Root
                placeholder="Senior React Engineer"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                required
              />
            </label>
            <label>
              <Text size="2" weight="medium" mb="1" as="div">
                Company *
              </Text>
              <TextField.Root
                placeholder="Acme Corp"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                required
              />
            </label>
            <label>
              <Text size="2" weight="medium" mb="1" as="div">
                Job URL
              </Text>
              <TextField.Root
                placeholder="https://jobs.example.com/..."
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
          </Flex>
          <Flex gap="3" mt="5" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray" type="button">
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Job"}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────
export default function ApplicationsPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [apps, setApps] = useState<AppData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.push("/login");
    }
  }, [isPending, session, router]);

  useEffect(() => {
    if (session?.user) {
      fetch("/api/applications")
        .then((r) => r.json())
        .then(setApps)
        .finally(() => setLoading(false));
    }
  }, [session]);

  if (isPending || !session?.user) return null;

  const handleMove = async (slug: string, status: ApplicationStatus) => {
    const res = await fetch(`/api/applications/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated = await res.json();
      setApps((prev) => prev.map((a) => (a.slug === slug ? updated : a)));
    }
  };

  const handleReject = (slug: string) => handleMove(slug, "rejected");

  const total = apps.length;
  const activeCount = apps.filter((a) => a.status !== "rejected").length;

  const byStatus = Object.fromEntries(
    COLUMNS.map((c) => [c.status, apps.filter((a) => a.status === c.status)])
  ) as Record<ApplicationStatus, AppData[]>;

  return (
    <Container size="4" p={{ initial: "4", md: "8" }}>
      {/* Header */}
      <Flex justify="between" align="center" mb="4" wrap="wrap" gap="3">
        <Box>
          <Flex align="center" gap="3">
            <Link href="/" style={{ color: "var(--gray-9)", textDecoration: "none", fontSize: 13 }}>
              &larr; Back
            </Link>
            <Heading size="8" mb="1">
              Application Pipeline
            </Heading>
          </Flex>
          {total > 0 && (
            <Text size="2" color="gray">
              {activeCount} active &middot; {total} total
            </Text>
          )}
        </Box>
        <AddApplicationDialog onCreated={(app) => setApps((prev) => [app, ...prev])} />
      </Flex>

      {/* Pipeline funnel */}
      {!loading && total > 0 && <PipelineFunnel apps={apps} />}

      {/* Loading */}
      {loading && (
        <Flex direction="column" gap="3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height="52px" />
          ))}
        </Flex>
      )}

      {/* Empty state */}
      {!loading && total === 0 && (
        <Card size="3" style={{ textAlign: "center" }}>
          <Flex direction="column" align="center" gap="4" p="6">
            <Heading size="5" color="gray">
              No applications yet
            </Heading>
            <Text color="gray" size="3">
              Click <Text weight="medium">+ Add</Text> to start tracking your job application pipeline.
            </Text>
          </Flex>
        </Card>
      )}

      {/* Grouped sections */}
      {!loading && total > 0 && (
        <Box>
          {COLUMNS.map((col) => (
            <StatusSection
              key={col.status}
              column={col}
              apps={byStatus[col.status] ?? []}
              onMove={handleMove}
              onReject={handleReject}
              defaultOpen={col.status !== "rejected"}
            />
          ))}
        </Box>
      )}
    </Container>
  );
}
