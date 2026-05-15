"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Flex,
  Heading,
  Link,
  Text,
  TextField,
} from "@radix-ui/themes";
import { signUp } from "@/lib/auth-client";

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    await signUp.email(
      { name, email, password },
      {
        onError: (ctx) => {
          setError(ctx.error.message);
          setLoading(false);
        },
        onSuccess: () => {
          window.location.href = "/";
        },
      }
    );
  }

  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
      <Card size="4" style={{ width: 400 }}>
        <form onSubmit={handleSubmit}>
          <Flex direction="column" gap="4">
            <Heading size="6" align="center">
              Create Account
            </Heading>

            {error && (
              <Text color="red" size="2" align="center">
                {error}
              </Text>
            )}

            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium">
                Name
              </Text>
              <TextField.Root
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </Flex>

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
                placeholder="Min 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </Flex>

            <Button type="submit" size="3" disabled={loading}>
              {loading ? "Creating account..." : "Sign Up"}
            </Button>

            <Text size="2" align="center">
              Already have an account?{" "}
              <Link href="/login">Sign in</Link>
            </Text>
          </Flex>
        </form>
      </Card>
    </Flex>
  );
}
