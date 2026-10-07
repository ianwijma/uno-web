"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { currentPlayer } from "@/lib/game/engine";
import { GameState, TableEvent } from "@/lib/game/types";
import { CardBack, PlayingCard } from "./card";
import { PlayerToken } from "./player-token";

export function useTablePresentation(
  state: GameState,
  replayInitialDeal = true,
) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(state);
  const [moving, setMoving] = useState<{
    id: number;
    events: TableEvent[];
  } | null>(null);
  const [announcement, setAnnouncement] = useState<{
    state: GameState;
    again: boolean;
  } | null>(null);
  const [animating, setAnimating] = useState(false);
  const queue = useRef<{ state: GameState; replay: boolean }[]>([]);
  const lastQueued = useRef(state.animation.id);
  const shownRef = useRef(state);
  const running = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const first = useRef(true);
  const timers = useRef(new Map<ReturnType<typeof setTimeout>, () => void>());
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        resolve();
      }, ms);
      timers.current.set(timer, resolve);
    });
  useEffect(() => {
    mounted.current = true;
    first.current = true;
    const currentGeneration = generation.current;
    const pendingTimers = timers.current;
    return () => {
      mounted.current = false;
      generation.current = currentGeneration + 1;
      running.current = false;
      queue.current = [];
      for (const [timer, resolve] of pendingTimers) {
        clearTimeout(timer);
        resolve();
      }
      pendingTimers.clear();
    };
  }, []);
  const receive = useEffectEvent((next: GameState) => {
    let replay = next.animation.id === lastQueued.current + 1;
    if (first.current) {
      first.current = false;
      replay =
        replayInitialDeal &&
        next.animation.events.some((e) => e.kind === "deal");
      if (!replay) return;
    } else if (next.animation.id <= lastQueued.current) {
      // Heartbeats and leader changes are not new card moves.
      if (next.ownerId !== shownRef.current.ownerId && !running.current) {
        shownRef.current = next;
        setShown(next);
      }
      return;
    }
    lastQueued.current = next.animation.id;
    queue.current.push({ state: next, replay });
    if (running.current) return;
    running.current = true;
    const token = generation.current;
    const alive = () => mounted.current && token === generation.current;
    void (async () => {
      setAnimating(true);
      while (queue.current.length && alive()) {
        const item = queue.current.shift()!;
        const events = item.replay ? item.state.animation.events : [];
        const flights = events.filter((e) => e.kind !== "turn");
        if (flights.length && !reduced) {
          setMoving({ id: item.state.animation.id, events: flights });
          await pause(
            flights.some((e) => e.kind === "deal")
              ? 1100
              : flights.length > 1
                ? 1000
                : 620,
          );
          if (!alive()) return;
          setMoving(null);
        }
        shownRef.current = item.state;
        setShown(item.state);
        const turn = events.find((e) => e.kind === "turn");
        if (turn) {
          setAnnouncement({
            state: item.state,
            again: turn.previousPlayerId === turn.playerId,
          });
          await pause(reduced ? 180 : 620);
          if (!alive()) return;
          setAnnouncement(null);
        }
      }
      if (alive()) {
        running.current = false;
        setAnimating(false);
      }
    })();
  });
  useEffect(() => {
    receive(state);
  }, [state]);
  return { shown, moving, announcement, animating, reduced };
}

type Point = { x: number; y: number };
function center(element: Element | null, width: number, height: number): Point {
  const box = element?.getBoundingClientRect();
  return box
    ? {
        x: box.left + box.width / 2 - width / 2,
        y: box.top + box.height / 2 - height / 2,
      }
    : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}
function measureFlights(events: TableEvent[]) {
  const deck = document.querySelector('[data-pile="draw"] .playing-card');
  const bounds = deck?.getBoundingClientRect();
  const width = bounds?.width ?? 82;
  const height = bounds?.height ?? 118;
  const hasPlay = events.some((e) => e.kind === "play");
  return events.flatMap((event, i) => {
    const seat = document.querySelector(
      `[data-seat="${CSS.escape(event.playerId)}"]`,
    );
    const card = event.card
      ? document.querySelector(`[data-card-id="${CSS.escape(event.card.id)}"]`)
      : null;
    const from = center(
      event.kind === "play" ? (card ?? seat) : deck,
      width,
      height,
    );
    const to = center(
      event.kind === "play"
        ? document.querySelector('[data-pile="discard"]')
        : seat,
      width,
      height,
    );
    return Array.from(
      { length: event.kind === "play" ? 1 : Math.min(event.count ?? 1, 3) },
      (_, j) => ({
        key: `${i}-${j}`,
        event,
        width,
        height,
        from,
        to,
        delay:
          (event.kind === "deal"
            ? i * 0.035
            : event.kind === "draw" && hasPlay
              ? 0.38
              : 0) +
          j * 0.055,
        angle: event.kind === "play" ? 4 : (j - 1) * 7,
      }),
    );
  });
}
export function TableFlights({ events }: { events: TableEvent[] }) {
  // The overlay mounts only in the browser after a committed move, with the
  // previous table still displayed so source and destination positions are stable.
  const [flights] = useState(() => measureFlights(events));
  return (
    <div
      className="flight-layer"
      aria-hidden="true"
      data-testid="card-animation"
    >
      {flights.map((flight) => (
        <motion.div
          key={flight.key}
          className="flying-card"
          style={{ width: flight.width, height: flight.height }}
          initial={{
            x: flight.from.x,
            y: flight.from.y,
            rotate: -8,
            opacity: 1,
          }}
          animate={{
            x: flight.to.x,
            y: flight.to.y,
            rotate: flight.angle,
            opacity: [1, 1, 0],
          }}
          transition={{
            duration: 0.48,
            delay: flight.delay,
            ease: [0.22, 0.7, 0.25, 1],
            opacity: {
              times: [0, 0.9, 1],
              duration: 0.48,
              delay: flight.delay,
            },
          }}
        >
          {flight.event.card ? (
            <PlayingCard card={flight.event.card} />
          ) : (
            <CardBack />
          )}
          {flight.event.kind !== "play" ? (
            <span className="flight-count">+{flight.event.count}</span>
          ) : null}
        </motion.div>
      ))}
    </div>
  );
}
export function TurnAnnouncement({
  announcement,
  selfId,
  reduced,
}: {
  announcement: ReturnType<typeof useTablePresentation>["announcement"];
  selfId: string;
  reduced: boolean | null;
}) {
  const player = announcement ? currentPlayer(announcement.state) : null;
  return (
    <AnimatePresence>
      {announcement && player ? (
        <motion.div
          key={announcement.state.turnSerial}
          className="turn-announcement"
          initial={{ opacity: 0, y: reduced ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : -8 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
          data-testid="turn-announcement"
        >
          <PlayerToken player={player} />
          <div>
            <span>
              {announcement.again ? "ANOTHER GO" : "PASSING THE TURN"}
            </span>
            <strong>
              {player.id === selfId
                ? announcement.again
                  ? "You go again."
                  : "Your turn."
                : `${player.name}${announcement.again ? " goes again." : "’s turn."}`}
            </strong>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
