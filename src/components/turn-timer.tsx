"use client";
import { useEffect, useState } from "react";
import { GameState } from "@/lib/game/types";

export function TurnTimer({ state }: { state: GameState }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, []);
  if (state.phase !== "playing") return null;
  const seconds =
    state.turnDeadline == null || now == null
      ? null
      : Math.max(0, Math.ceil((state.turnDeadline - now) / 1000));
  return (
    <div
      className={`turn-timer ${seconds !== null && seconds <= 5 ? "urgent" : ""}`}
      role="timer"
      aria-label="Turn time remaining"
      data-deadline={state.turnDeadline ?? "unlimited"}
    >
      <span>TURN CLOCK</span>
      <strong>
        {!state.turnTimeoutSeconds
          ? "Unlimited"
          : seconds === null
            ? "…"
            : seconds === 0
              ? "Time’s up · confirming"
              : `${seconds}s remaining`}
      </strong>
    </div>
  );
}
