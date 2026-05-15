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
  FileTextIcon,
  ImageIcon,
  UploadIcon,
  TrashIcon,
  DownloadIcon,
  Pencil1Icon,
} from "@radix-ui/react-icons";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import type { Learner, Coursework } from "@/src/db/schema";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return <ImageIcon width={18} height={18} />;
  return <FileTextIcon width={18} height={18} />;
}

function isPreviewable(mime: string) {
  return mime === "application/pdf" || mime.startsWith("image/");
}

// ──────────────────────────────────────────────────────────────────────────────
// Learner Card
// ──────────────────────────────────────────────────────────────────────────────
function LearnerCard({
  learner,
  active,
  fileCount,
  onSelect,
  onDelete,
}: {
  learner: Learner;
  active: boolean;
  fileCount: number;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <Card
      className={`cw-learner-card${active ? " cw-learner-card--active" : ""}`}
      onClick={onSelect}
      style={{ cursor: "pointer" }}
    >
      <Flex justify="between" align="start">
        <Box>
          <Text size="3" weight="bold">
            {learner.name}
          </Text>
          <Flex gap="2" mt="1" align="center">
            <Badge size="1" variant="soft" color="gray">
              Age {learner.age}
            </Badge>
            <Badge size="1" variant="soft" color="teal">
              {fileCount} file{fileCount !== 1 ? "s" : ""}
            </Badge>
          </Flex>
        </Box>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton size="1" variant="ghost" color="gray" onClick={(e) => e.stopPropagation()}>
              <DotsHorizontalIcon />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content size="1">
            <DropdownMenu.Item color="red" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
              <TrashIcon /> Remove
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Flex>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// File Row
// ──────────────────────────────────────────────────────────────────────────────
function FileRow({
  item,
  onDelete,
  onPreview,
}: {
  item: Coursework;
  onDelete: () => void;
  onPreview: () => void;
}) {
  return (
    <Flex
      className="cw-file-row"
      align="center"
      justify="between"
      px="3"
      py="3"
    >
      <Flex
        align="center"
        gap="3"
        style={{ flex: 1, minWidth: 0, cursor: isPreviewable(item.mimeType) ? "pointer" : "default" }}
        onClick={() => isPreviewable(item.mimeType) && onPreview()}
      >
        <Box style={{ color: "var(--accent-9)", flexShrink: 0 }}>
          {fileIcon(item.mimeType)}
        </Box>
        <Box style={{ minWidth: 0 }}>
          <Text size="2" weight="medium" truncate>
            {item.title}
          </Text>
          <Flex gap="2" mt="1" align="center">
            {item.subject && (
              <Badge size="1" variant="outline" color="teal">
                {item.subject}
              </Badge>
            )}
            <Text size="1" color="gray">
              {formatSize(item.fileSize)}
            </Text>
            <Text size="1" color="gray">
              {formatDate(item.submittedAt)}
            </Text>
          </Flex>
        </Box>
      </Flex>
      <Flex gap="1" flexShrink="0">
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          asChild
        >
          <a href={item.fileUrl} download={item.fileName} target="_blank" rel="noopener noreferrer">
            <DownloadIcon />
          </a>
        </IconButton>
        <IconButton size="1" variant="ghost" color="red" onClick={onDelete}>
          <TrashIcon />
        </IconButton>
      </Flex>
    </Flex>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Preview Dialog
// ──────────────────────────────────────────────────────────────────────────────
function PreviewDialog({
  item,
  open,
  onClose,
}: {
  item: Coursework | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!item) return null;
  const isPdf = item.mimeType === "application/pdf";
  const isImage = item.mimeType.startsWith("image/");

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Content maxWidth="720px">
        <Dialog.Title>{item.title}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          {item.fileName} &middot; {formatSize(item.fileSize)}
        </Dialog.Description>
        <Box className="cw-preview">
          {isPdf && (
            <iframe
              src={item.fileUrl}
              title={item.title}
              style={{ width: "100%", height: 500, border: "none" }}
            />
          )}
          {isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.fileUrl}
              alt={item.title}
              style={{ width: "100%", maxHeight: 600, objectFit: "contain" }}
            />
          )}
        </Box>
        <Flex justify="end" mt="4" gap="2">
          <Button variant="soft" color="gray" asChild>
            <a href={item.fileUrl} download={item.fileName} target="_blank" rel="noopener noreferrer">
              <DownloadIcon /> Download
            </a>
          </Button>
          <Dialog.Close>
            <Button variant="soft">Close</Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────────────────────────────────────
export default function CourseworkPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [learnersList, setLearnersList] = useState<Learner[]>([]);
  const [files, setFiles] = useState<Coursework[]>([]);
  const [activeLearner, setActiveLearner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Add learner dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState("");
  const [adding, setAdding] = useState(false);

  // Upload dialog
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadSubject, setUploadSubject] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preview
  const [previewItem, setPreviewItem] = useState<Coursework | null>(null);

  // ── Fetch data ──
  const fetchData = useCallback(async () => {
    try {
      const [lr, cw] = await Promise.all([
        fetch("/api/learners").then((r) => r.json()),
        fetch("/api/coursework").then((r) => r.json()),
      ]);
      setLearnersList(Array.isArray(lr) ? lr : []);
      setFiles(Array.isArray(cw) ? cw : []);
      if (Array.isArray(lr) && lr.length > 0 && !activeLearner) {
        setActiveLearner(lr[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [activeLearner]);

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
      return;
    }
    if (session) fetchData();
  }, [session, isPending, router, fetchData]);

  // ── Add learner ──
  async function handleAddLearner() {
    if (!newName.trim() || !newAge.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/learners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), age: Number(newAge) }),
      });
      const row = await res.json();
      setLearnersList((prev) => [row, ...prev]);
      setActiveLearner(row.id);
      setNewName("");
      setNewAge("");
      setAddOpen(false);
    } finally {
      setAdding(false);
    }
  }

  // ── Delete learner ──
  async function handleDeleteLearner(id: string) {
    await fetch(`/api/learners/${id}`, { method: "DELETE" });
    setLearnersList((prev) => prev.filter((l) => l.id !== id));
    setFiles((prev) => prev.filter((f) => f.learnerId !== id));
    if (activeLearner === id) {
      const remaining = learnersList.filter((l) => l.id !== id);
      setActiveLearner(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  // ── Upload file ──
  async function handleUpload() {
    if (!uploadFile || !activeLearner) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("learnerId", activeLearner);
      formData.append("title", uploadTitle.trim() || uploadFile.name);
      if (uploadSubject.trim()) formData.append("subject", uploadSubject.trim());

      const res = await fetch("/api/coursework/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const row = await res.json();
      setFiles((prev) => [row, ...prev]);

      setUploadTitle("");
      setUploadSubject("");
      setUploadFile(null);
      setUploadOpen(false);
    } finally {
      setUploading(false);
    }
  }

  // ── Delete file ──
  async function handleDeleteFile(id: string) {
    await fetch(`/api/coursework/${id}`, { method: "DELETE" });
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  // ── Drag-and-drop ──
  function handleDrag(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) setUploadFile(e.dataTransfer.files[0]);
  }

  // ── Derived state ──
  const activeFiles = files.filter((f) => f.learnerId === activeLearner);
  const fileCounts = files.reduce<Record<string, number>>((acc, f) => {
    acc[f.learnerId] = (acc[f.learnerId] || 0) + 1;
    return acc;
  }, {});

  if (isPending || loading) {
    return (
      <Container size="3" py="8">
        <Skeleton height="40px" mb="4" />
        <Skeleton height="200px" />
      </Container>
    );
  }

  return (
    <Container size="3" py="8" className="cw-container">
      {/* Header */}
      <Flex justify="between" align="center" mb="6">
        <Heading size="7">Coursework</Heading>
        <Dialog.Root open={addOpen} onOpenChange={setAddOpen}>
          <Dialog.Trigger>
            <Button>
              <PlusIcon /> Add Learner
            </Button>
          </Dialog.Trigger>
          <Dialog.Content maxWidth="400px">
            <Dialog.Title>Register Learner</Dialog.Title>
            <Dialog.Description size="2" color="gray" mb="4">
              Add a learner to manage their coursework submissions.
            </Dialog.Description>
            <Flex direction="column" gap="3">
              <label>
                <Text size="2" weight="medium" mb="1" as="p">
                  Name
                </Text>
                <TextField.Root
                  placeholder="Full name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
              <label>
                <Text size="2" weight="medium" mb="1" as="p">
                  Age
                </Text>
                <TextField.Root
                  type="number"
                  placeholder="Age"
                  value={newAge}
                  onChange={(e) => setNewAge(e.target.value)}
                  min={1}
                  max={120}
                />
              </label>
            </Flex>
            <Flex justify="end" mt="4" gap="2">
              <Dialog.Close>
                <Button variant="soft" color="gray">Cancel</Button>
              </Dialog.Close>
              <Button onClick={handleAddLearner} disabled={adding || !newName.trim() || !newAge.trim()}>
                {adding ? "Adding..." : "Add Learner"}
              </Button>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      </Flex>

      {/* Learner cards */}
      {learnersList.length === 0 ? (
        <Card style={{ textAlign: "center", padding: "48px 24px" }}>
          <Text size="3" color="gray">
            No learners registered yet. Add a learner to start managing coursework.
          </Text>
        </Card>
      ) : (
        <>
          <Flex gap="3" mb="5" wrap="wrap">
            {learnersList.map((l) => (
              <LearnerCard
                key={l.id}
                learner={l}
                active={activeLearner === l.id}
                fileCount={fileCounts[l.id] || 0}
                onSelect={() => setActiveLearner(l.id)}
                onDelete={() => handleDeleteLearner(l.id)}
              />
            ))}
          </Flex>

          {/* Upload bar + files */}
          {activeLearner && (
            <Box>
              <Flex justify="between" align="center" mb="4">
                <Text size="4" weight="bold">
                  Files for {learnersList.find((l) => l.id === activeLearner)?.name}
                </Text>
                <Dialog.Root open={uploadOpen} onOpenChange={setUploadOpen}>
                  <Dialog.Trigger>
                    <Button variant="soft">
                      <UploadIcon /> Upload
                    </Button>
                  </Dialog.Trigger>
                  <Dialog.Content maxWidth="480px">
                    <Dialog.Title>Submit Coursework</Dialog.Title>
                    <Dialog.Description size="2" color="gray" mb="4">
                      Upload a file on behalf of{" "}
                      {learnersList.find((l) => l.id === activeLearner)?.name}.
                    </Dialog.Description>
                    <Flex direction="column" gap="3">
                      <label>
                        <Text size="2" weight="medium" mb="1" as="p">
                          Title
                        </Text>
                        <TextField.Root
                          placeholder="e.g. Week 3 Assignment"
                          value={uploadTitle}
                          onChange={(e) => setUploadTitle(e.target.value)}
                        />
                      </label>
                      <label>
                        <Text size="2" weight="medium" mb="1" as="p">
                          Subject (optional)
                        </Text>
                        <TextField.Root
                          placeholder="e.g. Mathematics"
                          value={uploadSubject}
                          onChange={(e) => setUploadSubject(e.target.value)}
                        />
                      </label>
                      {/* Drop zone */}
                      <Box
                        className={`cw-drop-zone${dragActive ? " cw-drop-zone--active" : ""}`}
                        onDragEnter={handleDrag}
                        onDragOver={handleDrag}
                        onDragLeave={handleDrag}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.doc,.docx"
                          style={{ display: "none" }}
                          onChange={(e) => e.target.files?.[0] && setUploadFile(e.target.files[0])}
                        />
                        {uploadFile ? (
                          <Flex direction="column" align="center" gap="1">
                            {fileIcon(uploadFile.type)}
                            <Text size="2" weight="medium">
                              {uploadFile.name}
                            </Text>
                            <Text size="1" color="gray">
                              {formatSize(uploadFile.size)}
                            </Text>
                          </Flex>
                        ) : (
                          <Flex direction="column" align="center" gap="1">
                            <UploadIcon width={24} height={24} />
                            <Text size="2" color="gray">
                              Drop file here or click to browse
                            </Text>
                            <Text size="1" color="gray">
                              PDF, images, or Word docs up to 10 MB
                            </Text>
                          </Flex>
                        )}
                      </Box>
                    </Flex>
                    <Flex justify="end" mt="4" gap="2">
                      <Dialog.Close>
                        <Button variant="soft" color="gray">Cancel</Button>
                      </Dialog.Close>
                      <Button onClick={handleUpload} disabled={uploading || !uploadFile}>
                        {uploading ? "Uploading..." : "Submit"}
                      </Button>
                    </Flex>
                  </Dialog.Content>
                </Dialog.Root>
              </Flex>

              {activeFiles.length === 0 ? (
                <Card style={{ textAlign: "center", padding: "32px 24px" }}>
                  <Text size="2" color="gray">
                    No coursework submitted yet. Click Upload to add files.
                  </Text>
                </Card>
              ) : (
                <Box className="cw-file-list">
                  {activeFiles.map((item) => (
                    <FileRow
                      key={item.id}
                      item={item}
                      onDelete={() => handleDeleteFile(item.id)}
                      onPreview={() => setPreviewItem(item)}
                    />
                  ))}
                </Box>
              )}
            </Box>
          )}
        </>
      )}

      <PreviewDialog
        item={previewItem}
        open={!!previewItem}
        onClose={() => setPreviewItem(null)}
      />
    </Container>
  );
}
