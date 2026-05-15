"use client";

import { useState } from "react";
import {
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Link,
  Text,
  TextField,
} from "@radix-ui/themes";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { signIn } from "@/lib/auth-client";

export default function LoginPage() {
  const [email, setEmail] = useState("nicolai.vadim@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signIn.email(
        { email, password },
        {
          onError: (ctx) => {
            const status = ctx.error.status ?? "";
            const msg = ctx.error.message || "Unknown error";
            setError(status ? `${status}: ${msg}` : msg);
            setLoading(false);
          },
          onSuccess: () => {
            window.location.href = "/";
          },
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Network error: ${msg}`);
      setLoading(false);
    }
  }

  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
      <Card size="4" style={{ width: 400 }}>
        <form onSubmit={handleSubmit}>
          <Flex direction="column" gap="4">
            <Heading size="6" align="center">
              Sign In
            </Heading>

            {error && (
              <Callout.Root color="red" size="1">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>{error}</Callout.Text>
              </Callout.Root>
            )}

            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium">
                Email
              </Text>
              <TextField.Root
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium">
                Password
              </Text>
              <TextField.Root
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Flex>

            <Button type="submit" size="3" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>

            <Text size="2" align="center">
              Don&apos;t have an account?{" "}
              <Link href="/signup">Sign up</Link>
            </Text>
          </Flex>
        </form>
      </Card>
    </Flex>
  );
}
