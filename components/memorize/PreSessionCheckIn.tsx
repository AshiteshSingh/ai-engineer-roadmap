"use client";

import { useState } from "react";
import { Heading, Text, Flex, Button } from "@radix-ui/themes";
import { detectTimeOfDay, type PreSessionState } from "@/lib/session-tracking";

const FOCUS_LABELS = ["😵", "😔", "😐", "🙂", "🔥"];
const ENERGY_LABELS = ["🪫", "😴", "😐", "⚡", "🚀"];

interface PreSessionCheckInProps {
  onStart: (preSession: PreSessionState | null) => void;
}

export function PreSessionCheckIn({ onStart }: PreSessionCheckInProps) {
  const [focusLevel, setFocusLevel] = useState<number | null>(null);
  const [energyLevel, setEnergyLevel] = useState<number | null>(null);

  const handleStart = () => {
    if (focusLevel !== null && energyLevel !== null) {
      onStart({
        focusLevel,
        energyLevel,
        timeOfDay: detectTimeOfDay(),
      });
    } else {
      onStart(null);
    }
  };

  return (
    <div className="session-checkin-overlay">
      <div className="session-checkin-card">
        <Heading size="4" mb="2">
          Quick Check-in
        </Heading>
        <Text size="2" color="gray" style={{ display: "block", marginBottom: 16 }}>
          How are you feeling right now? (Optional — helps track your best study conditions)
        </Text>

        <Flex direction="column" gap="3">
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">Focus Level</Text>
            <Flex gap="2">
              {FOCUS_LABELS.map((emoji, i) => (
                <button
                  key={i}
                  className={`session-checkin-emoji ${focusLevel === i + 1 ? "session-checkin-emoji--active" : ""}`}
                  onClick={() => setFocusLevel(i + 1)}
                  aria-label={`Focus level ${i + 1}`}
                >
                  {emoji}
                </button>
              ))}
            </Flex>
          </Flex>

          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">Energy Level</Text>
            <Flex gap="2">
              {ENERGY_LABELS.map((emoji, i) => (
                <button
                  key={i}
                  className={`session-checkin-emoji ${energyLevel === i + 1 ? "session-checkin-emoji--active" : ""}`}
                  onClick={() => setEnergyLevel(i + 1)}
                  aria-label={`Energy level ${i + 1}`}
                >
                  {emoji}
                </button>
              ))}
            </Flex>
          </Flex>
        </Flex>

        <Flex gap="2" mt="4" justify="end">
          <Button
            size="2"
            variant="ghost"
            color="gray"
            onClick={() => onStart(null)}
          >
            Skip
          </Button>
          <Button size="2" variant="solid" color="violet" onClick={handleStart}>
            Start Practice
          </Button>
        </Flex>
      </div>
    </div>
  );
}
