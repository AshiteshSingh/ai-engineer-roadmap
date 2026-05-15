"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Flex,
  Heading,
  Button,
  Box,
  Text,
  Dialog,
  IconButton,
  Avatar,
  Badge,
  DropdownMenu,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import {
  Pencil1Icon,
  DotsHorizontalIcon,
  TrashIcon,
  ExternalLinkIcon,
  ChevronDownIcon,
} from "@radix-ui/react-icons";
import type { AppData, ApplicationStatus } from "./types";
import { formatDate, companyInitials, COLUMNS } from "./constants";

interface ApplicationHeaderProps {
  app: AppData;
  isAdmin: boolean;
  onUpdate: (updated: AppData) => void;
  onSlugChange?: (newSlug: string) => void;
}

export function ApplicationHeader({ app, isAdmin, onUpdate, onSlugChange }: ApplicationHeaderProps) {
  const router = useRouter();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editingApp, setEditingApp] = useState(false);
  const [positionValue, setPositionValue] = useState("");
  const [companyValue, setCompanyValue] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [slugValue, setSlugValue] = useState("");
  const [appSaving, setAppSaving] = useState(false);
  const [appSaveError, setAppSaveError] = useState<string | null>(null);

  const displayName = app.company;
  const displayTitle = app.position;
  const initials = companyInitials(displayName ?? "?");
  const statusCol = COLUMNS.find((c) => c.status === app.status);
  const statusColorToken = statusCol?.color ?? "gray";
  const statusCssColor = `var(--${statusColorToken}-9)`;
  const jobUrl = app.url?.startsWith("http") ? app.url : null;

  const handleStatusChange = async (status: ApplicationStatus) => {
    const res = await fetch(`/api/applications/${app.slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated = await res.json();
      onUpdate(updated);
    }
  };

  const handleSaveApp = async () => {
    setAppSaving(true);
    setAppSaveError(null);
    try {
      const cleanSlug = slugValue.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const slugChanged = cleanSlug && cleanSlug !== app.slug;
      const res = await fetch(`/api/applications/${app.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position: positionValue || undefined,
          company: companyValue || undefined,
          url: urlValue || null,
          ...(slugChanged && { slug: cleanSlug }),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const updated = await res.json();
      onUpdate(updated);
      setEditingApp(false);
      if (slugChanged && onSlugChange) {
        onSlugChange(cleanSlug);
      }
    } catch (e) {
      setAppSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setAppSaving(false);
    }
  };

  return (
    <>
      {/* Breadcrumb + overflow menu */}
      <Flex justify="between" align="center" mb="4">
        <Flex align="center" gap="1">
          <Text size="1" color="gray" asChild>
            <Link href="/applications" style={{ color: "inherit", textDecoration: "none" }}>
              Applications
            </Link>
          </Text>
          <Text size="1" color="gray">/</Text>
          <Text size="1" weight="medium" title={displayTitle}>
            {displayTitle.length > 40 ? displayTitle.slice(0, 40) + "\u2026" : displayTitle}
          </Text>
        </Flex>
        {isAdmin && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton size="2" variant="ghost" color="gray">
                <DotsHorizontalIcon />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content size="1">
              <DropdownMenu.Item onClick={() => {
                setPositionValue(app.position);
                setCompanyValue(app.company);
                setUrlValue(app.url ?? "");
                setSlugValue(app.slug);
                setAppSaveError(null);
                setEditingApp(true);
              }}>
                <Pencil1Icon /> Edit application
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item color="red" onClick={() => setDeleteDialogOpen(true)}>
                <TrashIcon /> Delete application
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        )}
      </Flex>

      {/* Delete confirmation dialog */}
      <Dialog.Root open={deleteDialogOpen} onOpenChange={(o) => { if (!o && !deleting) setDeleteDialogOpen(false); }}>
        <Dialog.Content maxWidth="400px">
          <Dialog.Title>Delete application?</Dialog.Title>
          <Dialog.Description size="2" color="gray">
            This will permanently delete this application and all associated data. This action cannot be undone.
          </Dialog.Description>
          <Flex gap="2" justify="end" mt="4">
            <Dialog.Close>
              <Button variant="soft" color="gray" size="2" disabled={deleting}>Cancel</Button>
            </Dialog.Close>
            <Button
              color="red"
              size="2"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  const res = await fetch(`/api/applications/${app.slug}`, { method: "DELETE" });
                  if (res.ok) router.push("/applications");
                } catch {
                  setDeleting(false);
                  setDeleteDialogOpen(false);
                }
              }}
            >
              {deleting ? "Deleting\u2026" : "Delete"}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Header */}
      <Flex
        gap={{ initial: "3", sm: "4" }}
        align="start"
        mb="2"
        direction={{ initial: "column", sm: "row" }}
      >
        <Avatar
          size="4"
          fallback={initials}
          variant="soft"
          color="indigo"
          style={{ flexShrink: 0 }}
        />
        <Box style={{ flex: 1, minWidth: 0, width: "100%" }}>
          <Heading size={{ initial: "5", sm: "6", md: "7" }} mb="1" style={{ wordBreak: "break-word" }}>
            {displayTitle}
          </Heading>
          <Flex align="center" gap="2" wrap="wrap">
            <Text size="3" color="gray">
              {app.company} &middot; Added {formatDate(app.createdAt)}
            </Text>
            <Badge
              color={statusCol?.color ?? "gray"}
              variant="soft"
              size="2"
              style={{ boxShadow: `0 0 6px ${statusCssColor}` }}
            >
              {statusCol?.label ?? app.status}
            </Badge>
            {isAdmin && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <Button variant="ghost" size="1" color="gray">
                    <ChevronDownIcon />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content size="1">
                  {COLUMNS.map((col) => (
                    <DropdownMenu.Item
                      key={col.status}
                      disabled={col.status === app.status}
                      onClick={() => handleStatusChange(col.status)}
                    >
                      <Badge color={col.color} variant="soft" size="1">{col.label}</Badge>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            )}
          </Flex>

          {/* Job URL */}
          <Flex align="center" gap="3" mt="1" wrap="wrap">
            {jobUrl ? (
              <a
                href={jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent-11)", textDecoration: "none" }}
              >
                <Text size="1">Job posting</Text>
                <ExternalLinkIcon width={12} height={12} />
              </a>
            ) : isAdmin ? (
              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => {
                  setPositionValue(app.position);
                  setCompanyValue(app.company);
                  setUrlValue(app.url ?? "");
                  setAppSaveError(null);
                  setEditingApp(true);
                }}
              >
                + Add job URL
              </Button>
            ) : null}
          </Flex>
        </Box>
      </Flex>

      {/* Edit application dialog */}
      <Dialog.Root open={editingApp} onOpenChange={(o) => { if (!o) setEditingApp(false); }}>
        <Dialog.Content maxWidth="480px">
          <Dialog.Title>Edit Application</Dialog.Title>
          <Flex direction="column" gap="3" mt="2">
            <Box>
              <Text size="2" weight="medium" mb="1" as="div">Position</Text>
              <TextField.Root
                value={positionValue}
                onChange={(e) => setPositionValue(e.target.value)}
                placeholder="e.g. Senior Frontend Engineer"
              />
            </Box>
            <Box>
              <Text size="2" weight="medium" mb="1" as="div">Company</Text>
              <TextField.Root
                value={companyValue}
                onChange={(e) => setCompanyValue(e.target.value)}
                placeholder="Acme Corp"
              />
            </Box>
            <Box>
              <Text size="2" weight="medium" mb="1" as="div">Slug</Text>
              <TextField.Root
                value={slugValue}
                onChange={(e) => setSlugValue(e.target.value)}
                placeholder="company-position"
              />
              <Text size="1" color="gray">/applications/{slugValue || "..."}</Text>
            </Box>
            <Box>
              <Text size="2" weight="medium" mb="1" as="div">Job URL</Text>
              <TextField.Root
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="https://jobs.example.com/..."
              />
            </Box>
            {appSaveError && <Text size="1" color="red">{appSaveError}</Text>}
          </Flex>
          <Flex gap="2" justify="end" mt="4">
            <Dialog.Close>
              <Button variant="soft" color="gray" size="2">Cancel</Button>
            </Dialog.Close>
            <Button size="2" disabled={appSaving} onClick={handleSaveApp}>
              {appSaving ? "Saving\u2026" : "Save"}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
