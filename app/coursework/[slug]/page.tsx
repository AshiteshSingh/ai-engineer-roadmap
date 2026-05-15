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
  Link as RadixLink,
} from "@radix-ui/themes";
import {
  FileTextIcon,
  ImageIcon,
  UploadIcon,
  TrashIcon,
  DownloadIcon,
  ArrowLeftIcon,
} from "@radix-ui/react-icons";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import NextLink from "next/link";
import { useSession } from "@/lib/auth-client";
import type { Learner, Coursework } from "@/src/db/schema";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

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
    <Flex className="cw-file-row" align="center" justify="between" px="3" py="3">
      <Flex
        align="center"
        gap="3"
        style={{ flex: 1, minWidth: 0, cursor: isPreviewable(item.mimeType) ? "pointer" : "default" }}
        onClick={() => isPreviewable(item.mimeType) && onPreview()}
      >
        <Box style={{ color: "var(--accent-9)", flexShrink: 0 }}>{fileIcon(item.mimeType)}</Box>
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
        <IconButton size="1" variant="ghost" color="gray" asChild>
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
            <iframe src={item.fileUrl} title={item.title} style={{ width: "100%", height: 500, border: "none" }} />
          )}
          {isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.fileUrl} alt={item.title} style={{ width: "100%", maxHeight: 600, objectFit: "contain" }} />
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

export default function LearnerCourseworkPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [learner, setLearner] = useState<Learner | null>(null);
  const [files, setFiles] = useState<Coursework[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Create-on-demand
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState("");
  const [creating, setCreating] = useState(false);

  // Upload dialog
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadSubject, setUploadSubject] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewItem, setPreviewItem] = useState<Coursework | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [lrRes, cwRes] = await Promise.all([
        fetch("/api/learners").then((r) => r.json()),
        fetch("/api/coursework").then((r) => r.json()),
      ]);
      const lrList: Learner[] = Array.isArray(lrRes) ? lrRes : [];
      const cwList: Coursework[] = Array.isArray(cwRes) ? cwRes : [];

      const match = lrList.find((l) => slugify(l.name) === slug);
      if (!match) {
        setLearner(null);
        setNotFound(true);
        setNewName(slug.charAt(0).toUpperCase() + slug.slice(1));
      } else {
        setLearner(match);
        setNotFound(false);
        setFiles(cwList.filter((f) => f.learnerId === match.id));
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
      return;
    }
    if (session) fetchData();
  }, [session, isPending, router, fetchData]);

  async function handleCreateLearner() {
    if (!newName.trim() || !newAge.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/learners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), age: Number(newAge) }),
      });
      const row: Learner = await res.json();
      const newSlug = slugify(row.name);
      if (newSlug !== slug) {
        router.replace(`/coursework/${newSlug}`);
      } else {
        setLearner(row);
        setNotFound(false);
        setFiles([]);
      }
      setCreateOpen(false);
    } finally {
      setCreating(false);
    }
  }

  async function handleUpload() {
    if (!uploadFile || !learner) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("learnerId", learner.id);
      formData.append("title", uploadTitle.trim() || uploadFile.name);
      if (uploadSubject.trim()) formData.append("subject", uploadSubject.trim());

      const res = await fetch("/api/coursework/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const row: Coursework = await res.json();
      setFiles((prev) => [row, ...prev]);

      setUploadTitle("");
      setUploadSubject("");
      setUploadFile(null);
      setUploadOpen(false);
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteFile(id: string) {
    await fetch(`/api/coursework/${id}`, { method: "DELETE" });
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

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

  if (isPending || loading) {
    return (
      <Container size="3" py="8">
        <Skeleton height="40px" mb="4" />
        <Skeleton height="200px" />
      </Container>
    );
  }

  if (notFound) {
    return (
      <Container size="3" py="8" className="cw-container">
        <Flex align="center" gap="2" mb="4">
          <RadixLink asChild color="gray">
            <NextLink href="/coursework">
              <Flex align="center" gap="1">
                <ArrowLeftIcon /> All learners
              </Flex>
            </NextLink>
          </RadixLink>
        </Flex>
        <Card style={{ textAlign: "center", padding: "48px 24px" }}>
          <Heading size="5" mb="2">
            No learner named &ldquo;{slug}&rdquo;
          </Heading>
          <Text size="2" color="gray" as="p" mb="4">
            Register this learner to start tracking their coursework.
          </Text>
          <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
            <Dialog.Trigger>
              <Button>Register {slug}</Button>
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
                  <Button variant="soft" color="gray">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button onClick={handleCreateLearner} disabled={creating || !newName.trim() || !newAge.trim()}>
                  {creating ? "Adding..." : "Add Learner"}
                </Button>
              </Flex>
            </Dialog.Content>
          </Dialog.Root>
        </Card>
      </Container>
    );
  }

  if (!learner) return null;

  return (
    <Container size="3" py="8" className="cw-container">
      <Flex align="center" gap="2" mb="4">
        <RadixLink asChild color="gray">
          <NextLink href="/coursework">
            <Flex align="center" gap="1">
              <ArrowLeftIcon /> All learners
            </Flex>
          </NextLink>
        </RadixLink>
      </Flex>

      <Flex justify="between" align="center" mb="6">
        <Box>
          <Heading size="7">{learner.name}</Heading>
          <Flex gap="2" mt="2" align="center">
            <Badge size="1" variant="soft" color="gray">
              Age {learner.age}
            </Badge>
            <Badge size="1" variant="soft" color="teal">
              {files.length} file{files.length !== 1 ? "s" : ""}
            </Badge>
          </Flex>
        </Box>
        <Dialog.Root open={uploadOpen} onOpenChange={setUploadOpen}>
          <Dialog.Trigger>
            <Button>
              <UploadIcon /> Upload
            </Button>
          </Dialog.Trigger>
          <Dialog.Content maxWidth="480px">
            <Dialog.Title>Submit Coursework</Dialog.Title>
            <Dialog.Description size="2" color="gray" mb="4">
              Upload a file on behalf of {learner.name}.
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
                <Button variant="soft" color="gray">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button onClick={handleUpload} disabled={uploading || !uploadFile}>
                {uploading ? "Uploading..." : "Submit"}
              </Button>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      </Flex>

      {files.length === 0 ? (
        <Card style={{ textAlign: "center", padding: "32px 24px" }}>
          <Text size="2" color="gray">
            No coursework submitted yet. Click Upload to add files.
          </Text>
        </Card>
      ) : (
        <Box className="cw-file-list">
          {files.map((item) => (
            <FileRow
              key={item.id}
              item={item}
              onDelete={() => handleDeleteFile(item.id)}
              onPreview={() => setPreviewItem(item)}
            />
          ))}
        </Box>
      )}

      <PreviewDialog item={previewItem} open={!!previewItem} onClose={() => setPreviewItem(null)} />
    </Container>
  );
}
