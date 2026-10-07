import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  assertCardConservation,
  canPlay,
  cardPoints,
  createLobby,
  currentPlayer,
  makeDeck,
  reduceGame,
} from "../src/lib/game/engine";
import { Card, GameState, Player } from "../src/lib/game/types";
const player = (id: string): Player => ({
  id,
  name: id,
  ready: true,
  score: 0,
});
function started(count = 3, seed = 123): GameState {
  let s = createLobby(player("p0"), 12);
  for (let i = 1; i < count; i++)
    s = reduceGame(s, `p${i}`, { type: "JOIN", player: player(`p${i}`) });
  for (const p of s.players)
    s = reduceGame(s, p.id, { type: "READY", ready: true });
  return reduceGame(s, "p0", { type: "START", seed });
}
function fixture(specs: string[][], topSpec = "red:5"): GameState {
  const s = started(specs.length);
  const remaining = makeDeck();
  const pick = (spec: string) => {
    const [color, value] = spec.split(":");
    const index = remaining.findIndex(
      (c) => (c.color ?? "null") === color && c.value === value,
    );
    if (index < 0) throw new Error(`Missing fixture card ${spec}`);
    return remaining.splice(index, 1)[0];
  };
  s.hands = Object.fromEntries(
    specs.map((spec, i) => [`p${i}`, spec.map(pick)]),
  );
  s.discard = [pick(topSpec)];
  s.drawPile = remaining;
  s.activeColor = s.discard[0].color ?? "red";
  s.turn = 0;
  s.direction = 1;
  s.challenge = null;
  s.pendingWild = null;
  s.hasDrawn = false;
  s.drawnCardId = null;
  return s;
}
const play = (s: GameState, value: Card["value"], uno = true) =>
  reduceGame(s, currentPlayer(s).id, {
    type: "PLAY",
    cardId: s.hands[currentPlayer(s).id].find((c) => c.value === value)!.id,
    color: "blue",
    uno,
  });

describe("classic UNO", () => {
  it("has the exact 108-card deck and scoring", () => {
    const deck = makeDeck();
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
    expect(deck.filter((c) => c.value === "0")).toHaveLength(4);
    expect(deck.filter((c) => c.value === "wild4")).toHaveLength(4);
    expect(cardPoints(deck.find((c) => c.value === "7")!)).toBe(7);
    expect(cardPoints(deck.find((c) => c.value === "skip")!)).toBe(20);
    expect(cardPoints(deck.find((c) => c.value === "wild")!)).toBe(50);
  });
  it("enforces readiness, capacity, ownership, and admission", () => {
    let s = createLobby(player("p0"), 2);
    expect(() => reduceGame(s, "p0", { type: "START", seed: 1 })).toThrow(
      /two/,
    );
    s = reduceGame(s, "p1", { type: "JOIN", player: player("p1") });
    expect(() =>
      reduceGame(s, "p2", { type: "JOIN", player: player("p2") }),
    ).toThrow(/full/);
    expect(() => reduceGame(s, "p1", { type: "SET_CAPACITY", max: 3 })).toThrow(
      /owner/,
    );
    expect(() => reduceGame(s, "p0", { type: "START", seed: 1 })).toThrow(
      /ready/,
    );
    expect(() =>
      reduceGame(started(), "p4", { type: "JOIN", player: player("p4") }),
    ).toThrow(/started/);
  });
  it("deals reproducibly and handles opening wilds/actions without losing cards", () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = started(3, seed);
      expect(s).toEqual(started(3, seed));
      expect(s.discard[0].value).not.toBe("wild4");
      expect(assertCardConservation(s)).toBe(true);
      expect(
        Object.values(s.hands).every((h) => h.length === 7 || h.length === 9),
      ).toBe(true);
      if (s.discard[0].value === "wild")
        expect(s.pendingWild?.playerId).toBe(currentPlayer(s).id);
      if (s.discard[0].value === "reverse") {
        expect(s.direction).toBe(-1);
        expect(s.turn).toBe(s.dealer);
      }
      if (s.discard[0].value === "skip")
        expect(s.turn).toBe((s.dealer + 2) % 3);
    }
  });
  it("matches symbols and refuses wrong colors and out-of-turn moves", () => {
    const s = fixture(
      [["blue:skip", "blue:8"], ["green:9"], ["yellow:1"]],
      "red:skip",
    );
    expect(canPlay(s, s.hands.p0[0])).toBe(true);
    expect(canPlay(s, s.hands.p0[1])).toBe(false);
    expect(() => reduceGame(s, "p1", { type: "DRAW" })).toThrow(/turn/);
    expect(() => play(s, "8")).toThrow(/Match/);
  });
  it("draws just one; only the drawn card may be played, and drawing can be voluntary", () => {
    let s = fixture([["red:7", "yellow:8"], ["green:9"], ["blue:1"]]);
    const drawnIndex = s.drawPile.findIndex(
      (c) => c.color === "red" && c.value === "2",
    );
    s.drawPile.push(...s.drawPile.splice(drawnIndex, 1));
    s = reduceGame(s, "p0", { type: "DRAW" });
    expect(s.hands.p0).toHaveLength(3);
    expect(s.hasDrawn).toBe(true);
    expect(() => play(s, "7")).toThrow(/drawn card/);
    expect(() => reduceGame(s, "p0", { type: "DRAW" })).toThrow(/already/);
    s = reduceGame(s, "p0", { type: "PASS" });
    expect(s.turn).toBe(1);
  });
  it("prevents passing before drawing and playing another player's card", () => {
    const s = fixture([["red:7"], ["green:9"], ["blue:1"]]);
    expect(() => reduceGame(s, "p0", { type: "PASS" })).toThrow(/Draw/);
    expect(() =>
      reduceGame(s, "p0", { type: "PLAY", cardId: s.hands.p1[0].id }),
    ).toThrow(/hand/);
  });
  it("Draw Two skips the next player; it cannot be stacked as a response", () => {
    let s = fixture([["red:draw2", "green:1"], ["blue:draw2"], ["yellow:2"]]);
    s = play(s, "draw2");
    expect(s.turn).toBe(2);
    expect(s.hands.p1).toHaveLength(3);
    expect(() => play({ ...s, turn: 2 }, "draw2")).toThrow();
    expect(() =>
      reduceGame(s, "p1", { type: "PLAY", cardId: s.hands.p1[0].id }),
    ).toThrow(/turn/);
  });
  it.each(["skip", "reverse", "draw2"] as const)(
    "%s lets the same player go again with two players",
    (value) => {
      const s = play(
        fixture([[`red:${value}`, "blue:1"], ["yellow:8"]]),
        value,
      );
      expect(s.turn).toBe(0);
      expect(s.hasDrawn).toBe(false);
    },
  );
  it("reverses order with three players", () => {
    const s = play(
      fixture([["red:reverse", "blue:1"], ["yellow:8"], ["green:8"]]),
      "reverse",
    );
    expect(s.turn).toBe(2);
    expect(s.direction).toBe(-1);
  });
  it("supports illegal Draw Four bluffs and successful challenges", () => {
    let s = fixture([["null:wild4", "red:9"], ["green:1"], ["blue:8"]]);
    s = play(s, "wild4");
    expect(s.challenge?.illegal).toBe(true);
    expect(() => reduceGame(s, "p1", { type: "DRAW" })).toThrow(/challenge/);
    s = reduceGame(s, "p1", { type: "RESOLVE_CHALLENGE", challenge: true });
    expect(s.hands.p0).toHaveLength(5);
    expect(s.hands.p1).toHaveLength(1);
    expect(s.turn).toBe(1);
    expect(s.activeColor).toBe("blue");
    expect(assertCardConservation(s)).toBe(true);
  });
  it("allows Draw Four with a matching number but no matching color; failed challenge draws six", () => {
    let s = fixture([["null:wild4", "green:5"], ["yellow:1"], ["blue:8"]]);
    s = play(s, "wild4");
    expect(s.challenge?.illegal).toBe(false);
    s = reduceGame(s, "p1", { type: "RESOLVE_CHALLENGE", challenge: true });
    expect(s.hands.p1).toHaveLength(7);
    expect(s.turn).toBe(2);
  });
  it("settles a final Draw Four before scoring and ends the match at 500", () => {
    let s = fixture([["null:wild4"], ["yellow:1"], ["blue:8"]]);
    s.players[0].score = 499;
    s = play(s, "wild4");
    expect(s.phase).toBe("playing");
    expect(s.challenge).not.toBeNull();
    s = reduceGame(s, "p1", { type: "RESOLVE_CHALLENGE", challenge: false });
    expect(s.hands.p1).toHaveLength(5);
    expect(s.phase).toBe("match-over");
    expect(s.winnerId).toBe("p0");
  });
  it("applies final Draw Two penalties before scoring", () => {
    const s = play(fixture([["red:draw2"], ["yellow:1"], ["blue:8"]]), "draw2");
    expect(s.hands.p1).toHaveLength(3);
    expect(s.phase).toBe("round-over");
    expect(s.players[0].score).toBe(
      [...s.hands.p1, ...s.hands.p2].reduce((n, c) => n + cardPoints(c), 0),
    );
  });
  it("UNO penalties require a catch; late catches are rejected", () => {
    let s = play(
      fixture([["red:7", "green:8"], ["yellow:1"], ["blue:8"]]),
      "7",
      false,
    );
    expect(s.unoVulnerable).toBe("p0");
    expect(s.hands.p0).toHaveLength(1);
    const caught = reduceGame(s, "p2", { type: "CATCH_UNO", playerId: "p0" });
    expect(caught.hands.p0).toHaveLength(3);
    const declared = reduceGame(s, "p0", { type: "UNO" });
    expect(declared.unoVulnerable).toBeNull();
    s = reduceGame(s, "p1", { type: "DRAW" });
    expect(() =>
      reduceGame(s, "p2", { type: "CATCH_UNO", playerId: "p0" }),
    ).toThrow(/caught/);
  });
  it("reshuffles discards while preserving the top card", () => {
    let s = fixture([["red:7", "green:8"], ["yellow:1"], ["blue:8"]]);
    const top = s.discard[0];
    s.discard.unshift(...s.drawPile);
    s.drawPile = [];
    s = reduceGame(s, "p0", { type: "DRAW" });
    expect(s.discard).toEqual([top]);
    expect(assertCardConservation(s)).toBe(true);
  });
  it("does not mutate inputs", () => {
    const s = fixture([["red:7", "green:8"], ["yellow:1"], ["blue:8"]]);
    const copy = structuredClone(s);
    play(s, "7");
    expect(s).toEqual(copy);
  });
  it("conserves every physical card through randomized games of 2–12 players", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (count, seed) => {
          let s = started(count, seed);
          for (let i = 0; i < 500 && s.phase === "playing"; i++) {
            const id = currentPlayer(s).id;
            if (s.pendingWild)
              s = reduceGame(s, s.pendingWild.playerId, {
                type: "COLOR",
                color: "red",
              });
            else if (s.challenge)
              s = reduceGame(s, id, {
                type: "RESOLVE_CHALLENGE",
                challenge: i % 2 === 0,
              });
            else {
              const playable = s.hands[id].filter(
                (c) => canPlay(s, c) && (!s.hasDrawn || c.id === s.drawnCardId),
              );
              if (playable.length)
                s = reduceGame(s, id, {
                  type: "PLAY",
                  cardId: playable[i % playable.length].id,
                  color: "blue",
                  uno: true,
                });
              else
                s = reduceGame(s, id, { type: s.hasDrawn ? "PASS" : "DRAW" });
            }
            expect(assertCardConservation(s)).toBe(true);
            expect(s.turn).toBeLessThan(count);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
