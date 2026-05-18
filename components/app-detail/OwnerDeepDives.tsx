"use client";

import Link from "next/link";
import { Card, Flex, Heading, Text } from "@radix-ui/themes";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import { ownerDeepDives } from "@/lib/owner";
import s from "./OwnerDeepDives.module.css";

/**
 * Owner-only "Deep dive" card on the prep page. The link is resolved from the
 * code registry in lib/owner.ts (NOT the regenerated aiInterviewQuestions), so
 * prep regeneration can never wipe it. The caller gates rendering on owner
 * status; this component additionally renders nothing when there are no
 * deep-dives for the slug. All styling is in OwnerDeepDives.module.css — no
 * inline styles.
 */
export function OwnerDeepDives({ appSlug }: { appSlug: string }) {
  const dives = ownerDeepDives(appSlug);
  if (dives.length === 0) return null;

  return (
    <Card className={s.card}>
      <Heading size="3" className={s.heading}>
        Owner deep-dives
      </Heading>
      <Flex direction="column" gap="1" asChild>
        <ul className={s.list}>
          {dives.map((d) => (
            <li key={d.slug} className={s.item}>
              <Link href={`/${d.slug}`} className={s.link}>
                <Flex align="center" gap="2">
                  <ArrowRightIcon className={s.icon} />
                  <Text size="2" weight="medium" className={s.label}>
                    {d.label}
                  </Text>
                </Flex>
                <Text size="2" className={s.blurb}>
                  {d.blurb}
                </Text>
              </Link>
            </li>
          ))}
        </ul>
      </Flex>
    </Card>
  );
}
