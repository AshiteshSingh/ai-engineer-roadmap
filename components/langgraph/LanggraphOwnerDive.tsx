import Link from "next/link";
import { Card, Flex, Heading, Text } from "@radix-ui/themes";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import { LANGGRAPH_OWNER_DIVES } from "@/lib/owner";
import s from "./LanggraphOwnerDive.module.css";

/**
 * Owner-only "Deep dive" card for the LangGraph area, modeled on
 * components/app-detail/OwnerDeepDives.tsx. The CALLER must gate rendering on
 * owner status server-side (see app/langgraph/lead-gen/page.tsx) so the
 * markup is never sent to non-owners. Links resolve to owner-gated topic
 * routes (e.g. /cortex-portal, itself layout-guarded).
 */
export function LanggraphOwnerDive() {
  if (LANGGRAPH_OWNER_DIVES.length === 0) return null;

  return (
    <Card className={s.card}>
      <Heading size="3" className={s.heading}>
        Owner deep-dives
      </Heading>
      <Flex direction="column" gap="1" asChild>
        <ul className={s.list}>
          {LANGGRAPH_OWNER_DIVES.map((d) => (
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
