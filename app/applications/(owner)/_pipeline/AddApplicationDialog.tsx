"use client";

import { Button, Flex, Dialog, TextField, Text } from "@radix-ui/themes";
import { PlusIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import type { AppData } from "@/components/app-detail/types";

export function AddApplicationDialog({
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
