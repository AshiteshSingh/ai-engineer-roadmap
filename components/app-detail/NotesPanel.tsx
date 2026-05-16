"use client";

import {
  Heading,
  Button,
  Flex,
  Text,
  Box,
  Card,
  TextArea,
  TextField,
  IconButton,
  Dialog,
  Skeleton,
} from "@radix-ui/themes";
import {
  Pencil1Icon,
  PlusIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactElement } from "react";
import { MermaidFlow } from "@/components/mermaid-flow";
import type { TabBaseProps } from "./types";
import s from "./NotesPanel.module.css";

interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotesPanelProps extends TabBaseProps {
  /** Discriminator stored on application_notes.kind ("note" | "debrief"). */
  kind: string;
  heading: string;
  addLabel: string;
  emptyLabel: string;
  newDialogTitle: string;
  deleteTitle: string;
  titlePlaceholder: string;
  contentPlaceholder: string;
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

export function NotesPanel({
  app,
  isAdmin,
  kind,
  heading,
  addLabel,
  emptyLabel,
  newDialogTitle,
  deleteTitle,
  titlePlaceholder,
  contentPlaceholder,
}: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleValue, setTitleValue] = useState("");
  const [contentValue, setContentValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Create state
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");

  // Delete state
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchNotes = useCallback(async () => {
    const data = await gql<{ applicationNotes: Note[] }>(
      `query ($appId: ID!, $kind: String) { applicationNotes(applicationId: $appId, kind: $kind) { id title content createdAt updatedAt } }`,
      { appId: app.id, kind },
    );
    setNotes(data.applicationNotes);
    setLoading(false);
  }, [app.id, kind]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setSaving(true);
    await gql(
      `mutation ($input: CreateApplicationNoteInput!) { createApplicationNote(input: $input) { id } }`,
      { input: { applicationId: app.id, title: newTitle, content: newContent, kind } },
    );
    setCreating(false);
    setNewTitle("");
    setNewContent("");
    setSaving(false);
    fetchNotes();
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    setSaving(true);
    await gql(
      `mutation ($id: ID!, $input: UpdateApplicationNoteInput!) { updateApplicationNote(id: $id, input: $input) { id } }`,
      { id: editingId, input: { title: titleValue, content: contentValue } },
    );
    setEditingId(null);
    setSaving(false);
    fetchNotes();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    await gql(
      `mutation ($id: ID!) { deleteApplicationNote(id: $id) }`,
      { id: deleteId },
    );
    setDeleteId(null);
    setDeleting(false);
    fetchNotes();
  };

  if (loading) {
    return (
      <Flex direction="column" gap="3">
        <Skeleton height="120px" />
        <Skeleton height="120px" />
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="3">
      {/* Header */}
      <Flex justify="between" align="center">
        <Heading size="4">{heading}</Heading>
        {isAdmin && (
          <Button size="1" variant="soft" onClick={() => setCreating(true)}>
            <PlusIcon /> {addLabel}
          </Button>
        )}
      </Flex>

      {/* Create dialog */}
      <Dialog.Root open={creating} onOpenChange={(o) => { if (!o) setCreating(false); }}>
        <Dialog.Content maxWidth="520px">
          <Dialog.Title>{newDialogTitle}</Dialog.Title>
          <Flex direction="column" gap="3" mt="2">
            <Box>
              <Text size="2" weight="medium" mb="1" as="div">Title</Text>
              <TextField.Root
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={titlePlaceholder}
              />
            </Box>
            <Box>
              <Text size="2" weight="medium" mb="1" as="div">Content</Text>
              <TextArea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={contentPlaceholder}
                rows={10}
                className={s.editArea}
              />
            </Box>
          </Flex>
          <Flex gap="2" justify="end" mt="4">
            <Dialog.Close>
              <Button variant="soft" color="gray" size="2">Cancel</Button>
            </Dialog.Close>
            <Button size="2" disabled={saving || !newTitle.trim()} onClick={handleCreate}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Delete confirmation */}
      <Dialog.Root open={!!deleteId} onOpenChange={(o) => { if (!o && !deleting) setDeleteId(null); }}>
        <Dialog.Content maxWidth="400px">
          <Dialog.Title>{deleteTitle}</Dialog.Title>
          <Dialog.Description size="2" color="gray">
            This cannot be undone.
          </Dialog.Description>
          <Flex gap="2" justify="end" mt="4">
            <Dialog.Close>
              <Button variant="soft" color="gray" size="2" disabled={deleting}>Cancel</Button>
            </Dialog.Close>
            <Button color="red" size="2" disabled={deleting} onClick={handleDelete}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Notes list */}
      {notes.length === 0 && (
        <Card className={s.noteCard}>
          <Flex direction="column" align="center" justify="center" gap="2" py="6" className={s.emptyBody}>
            <Text size="2" color="gray">{emptyLabel}</Text>
            {isAdmin && (
              <Button variant="soft" size="1" mt="1" onClick={() => setCreating(true)}>
                {addLabel}
              </Button>
            )}
          </Flex>
        </Card>
      )}

      {notes.map((note) => (
        <Card key={note.id} className={s.noteCard}>
          {editingId === note.id ? (
            <Flex direction="column" gap="2">
              <TextField.Root
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                placeholder="Title"
              />
              <TextArea
                value={contentValue}
                onChange={(e) => setContentValue(e.target.value)}
                rows={10}
                className={s.editArea}
              />
              <Flex gap="2" justify="end">
                <Button variant="soft" color="gray" size="1" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
                <Button size="1" disabled={saving} onClick={handleUpdate}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </Flex>
            </Flex>
          ) : (
            <>
              <Flex justify="between" align="center" mb="2">
                <Heading size="3">{note.title}</Heading>
                {isAdmin && (
                  <Flex gap="1">
                    <IconButton
                      size="1"
                      variant="ghost"
                      color="gray"
                      onClick={() => {
                        setEditingId(note.id);
                        setTitleValue(note.title);
                        setContentValue(note.content);
                      }}
                    >
                      <Pencil1Icon />
                    </IconButton>
                    <IconButton
                      size="1"
                      variant="ghost"
                      color="red"
                      onClick={() => setDeleteId(note.id)}
                    >
                      <TrashIcon />
                    </IconButton>
                  </Flex>
                )}
              </Flex>
              <Text size="1" color="gray" mb="2" as="div">
                {new Date(note.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </Text>
              <Box className="interview-prep-md">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <Heading size="5" mb="2" mt="4">{children}</Heading>
                    ),
                    h2: ({ children }) => (
                      <Box mt="5" mb="2" pt="4" className={s.mdH2Rule}>
                        <Heading size="4">{children}</Heading>
                      </Box>
                    ),
                    h3: ({ children }) => (
                      <Box mt="4" mb="2" p="3" className={s.mdH3Box}>
                        <Heading size="3">{children}</Heading>
                      </Box>
                    ),
                    p: ({ children }) => (
                      <Text as="p" size="2" mb="2" className={s.mdP}>{children}</Text>
                    ),
                    strong: ({ children }) => (
                      <strong className={s.mdStrong}>{children}</strong>
                    ),
                    ul: ({ children }) => (
                      <ul className={s.mdList}>{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className={s.mdList}>{children}</ol>
                    ),
                    li: ({ children }) => (
                      <li className={s.mdLi}>{children}</li>
                    ),
                    blockquote: ({ children }) => (
                      <Box mb="3" pl="3" className={s.mdBlockquote}>
                        {children}
                      </Box>
                    ),
                    pre: ({ children }: { children?: React.ReactNode }) => {
                      const codeEl = children as ReactElement<{ className?: string; children?: string }>;
                      if (codeEl?.props) {
                        const m = codeEl.props.className?.match(/language-(\w+)/);
                        if (m?.[1] === "mermaid") {
                          const raw = String(codeEl.props.children || "").replace(/\n$/, "");
                          return <MermaidFlow chart={raw} />;
                        }
                      }
                      return <pre>{children}</pre>;
                    },
                    code: ({ children, className }) => {
                      const isBlock = className?.includes("language-");
                      return isBlock ? (
                        <Box mb="3" p="3" className={s.mdCodeBlock}>
                          <pre className={s.mdCodeBlockPre}>
                            <code>{children}</code>
                          </pre>
                        </Box>
                      ) : (
                        <code className={s.mdCodeInline}>
                          {children}
                        </code>
                      );
                    },
                    hr: () => <Box mb="4" className={s.mdHrRule} />,
                  }}
                >
                  {note.content}
                </ReactMarkdown>
              </Box>
            </>
          )}
        </Card>
      ))}
    </Flex>
  );
}
