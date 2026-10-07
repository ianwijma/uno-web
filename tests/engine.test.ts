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
import { playerColors, classicRules } from "../src/lib/game/settings";
import { Card, GameState, Player } from "../src/lib/game/types";
const player = (id: string): Player => ({
  id,
  name: id,
  ready: true,
  score: 0,
  wins: 0,
  color: null,
});
function started(count = 3, seed = 123): GameState {
  let s = createLobby(player("p0"), 12);
  for (let i = 1; i < count; i++)
    s = reduceGame(s, `p${i}`, { type: "JOIN", player: player(`p${i}`) });
  for (const [i, p] of s.players.entries()) {
    s = reduceGame(s, p.id, { type: "PICK_COLOR", color: playerColors[i].id });
    s = reduceGame(s, p.id, { type: "READY", ready: true });
  }
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

describe("table settings and house rules", () => {
  it("requires a unique playing piece before readying and rejects conflicting claims", () => {
    let s = createLobby(player("p0"), 12);
    s = reduceGame(s, "p1", { type: "JOIN", player: player("p1") });
    expect(() => reduceGame(s, "p0", { type: "READY", ready: true })).toThrow(
      /color/,
    );
    s = reduceGame(s, "p0", { type: "PICK_COLOR", color: "cherry" });
    expect(() =>
      reduceGame(s, "p1", { type: "PICK_COLOR", color: "cherry" }),
    ).toThrow(/taken/);
    s = reduceGame(s, "p0", { type: "READY", ready: true });
    s = reduceGame(s, "p0", { type: "PICK_COLOR", color: "lemon" });
    expect(s.players[0].ready).toBe(false);
    s = reduceGame(s, "p1", { type: "PICK_COLOR", color: "cherry" });
    expect(s.players.map((p) => p.color)).toEqual(["lemon", "cherry"]);
    expect(() =>
      reduceGame(started(), "p0", { type: "PICK_COLOR", color: "cobalt" }),
    ).toThrow(/locked/);
    const twelve = started(12);
    expect(new Set(twelve.players.map((p) => p.color)).size).toBe(12);
  });
  it("only the owner can configure the lobby; rule and goal changes reset readiness", () => {
    let s = createLobby(player("p0"), 3);
    s = reduceGame(s, "p1", { type: "JOIN", player: player("p1") });
    s = reduceGame(s, "p0", { type: "PICK_COLOR", color: "cherry" });
    s = reduceGame(s, "p0", { type: "READY", ready: true });
    expect(() =>
      reduceGame(s, "p1", {
        type: "SET_GOAL",
        goal: { mode: "rounds", target: 3 },
      }),
    ).toThrow(/owner/);
    s = reduceGame(s, "p0", {
      type: "SET_GOAL",
      goal: { mode: "rounds", target: 3 },
    });
    expect(s.players.every((p) => !p.ready)).toBe(true);
    s = reduceGame(s, "p0", { type: "READY", ready: true });
    s = reduceGame(s, "p0", {
      type: "SET_RULES",
      rules: { ...classicRules, stackDrawTwo: true },
    });
    expect(s.players.every((p) => !p.ready)).toBe(true);
    expect(() =>
      reduceGame(started(), "p0", { type: "SET_RULES", rules: classicRules }),
    ).toThrow(/before play/);
    expect(() =>
      reduceGame(s, "p0", {
        type: "SET_GOAL",
        goal: { mode: "rounds", target: 0 },
      }),
    ).toThrow();
  });
  it("tracks rounds won independently of points and honors either goal", () => {
    let s = fixture([["red:7"], ["null:wild"], ["blue:8"]]);
    s.goal = { mode: "rounds", target: 2 };
    s.players[0].score = 900;
    s = play(s, "7");
    expect(s.phase).toBe("round-over");
    expect(s.players[0].wins).toBe(1);
    let roundWin = fixture([["red:7"], ["null:wild"], ["blue:8"]]);
    roundWin.goal = { mode: "rounds", target: 2 };
    roundWin.players[0].wins = 1;
    roundWin = play(roundWin, "7");
    expect(roundWin.phase).toBe("match-over");
    expect(roundWin.players[0].wins).toBe(2);
    let points = fixture([["red:7"], ["null:wild"], ["blue:8"]]);
    points.goal = { mode: "points", target: 50 };
    points = play(points, "7");
    expect(points.phase).toBe("match-over");
    expect(points.players[0].score).toBe(58);
  });
  it("stacks +2 across colors and takes the accumulated penalty without mixing +4", () => {
    let s = fixture([
      ["red:draw2", "yellow:1"],
      ["blue:draw2", "yellow:2"],
      ["null:wild4", "blue:8"],
    ]);
    s.rules.stackDrawTwo = true;
    s = play(s, "draw2");
    expect(s.pendingDrawTwo).toBe(2);
    expect(s.turn).toBe(1);
    expect(s.hands.p1).toHaveLength(2);
    s = play(s, "draw2");
    expect(s.pendingDrawTwo).toBe(4);
    expect(s.turn).toBe(2);
    expect(() => play(s, "wild4")).toThrow(/Match/);
    s = reduceGame(s, "p2", { type: "DRAW" });
    expect(s.hands.p2).toHaveLength(6);
    expect(s.turn).toBe(0);
    expect(s.pendingDrawTwo).toBe(0);
    expect(assertCardConservation(s)).toBe(true);
  });
  it("settles the whole +2 stack before scoring a final +2", () => {
    let s = fixture([["red:draw2", "yellow:1"], ["blue:draw2"], ["green:8"]]);
    s.rules.stackDrawTwo = true;
    s = play(s, "draw2");
    s = play(s, "draw2");
    expect(s.phase).toBe("round-over");
    expect(s.winnerId).toBe("p1");
    expect(s.hands.p2).toHaveLength(5);
    expect(s.pendingDrawTwo).toBe(0);
  });
  it("draws until a playable card and enforces playing only that card when required", () => {
    let s = fixture([["red:7", "yellow:1"], ["green:8"], ["blue:8"]]);
    const pull = (color: string, value: string) =>
      s.drawPile.splice(
        s.drawPile.findIndex((c) => c.color === color && c.value === value),
        1,
      )[0];
    const playable = pull("red", "2");
    const miss1 = pull("blue", "1");
    const miss2 = pull("green", "1");
    s.drawPile.push(playable, miss2, miss1);
    s.rules.drawUntilPlayable = true;
    s.rules.mustPlayDrawn = true;
    s = reduceGame(s, "p0", { type: "DRAW" });
    expect(s.hands.p0).toHaveLength(5);
    expect(s.drawnCardId).toBe(playable.id);
    expect(s.animation.events).toContainEqual({
      kind: "draw",
      playerId: "p0",
      count: 3,
    });
    expect(() => reduceGame(s, "p0", { type: "PASS" })).toThrow(/requires/);
    expect(() => play(s, "7")).toThrow(/drawn card/);
    s = play(s, "2");
    expect(s.turn).toBe(1);
    expect(assertCardConservation(s)).toBe(true);
  });
  it("stops drawing when all available cards run out", () => {
    let s = fixture([["blue:1"], ["green:8"], ["yellow:8"]]);
    const misses = s.drawPile.filter(
      (c) => c.color === "blue" && c.value === "2",
    );
    s.hands.p1.push(...s.drawPile.filter((c) => !misses.includes(c)));
    s.drawPile = misses;
    s.rules.drawUntilPlayable = true;
    s.rules.mustPlayDrawn = true;
    s = reduceGame(s, "p0", { type: "DRAW" });
    expect(s.turn).toBe(1);
    expect(s.drawPile).toHaveLength(0);
    expect(assertCardConservation(s)).toBe(true);
  });
  it("disables missed-UNO penalties when the table chooses", () => {
    let s = fixture([["red:7", "green:8"], ["yellow:1"], ["blue:8"]]);
    s.rules.unoPenalty = false;
    s = play(s, "7", false);
    expect(s.unoVulnerable).toBeNull();
    expect(() =>
      reduceGame(s, "p2", { type: "CATCH_UNO", playerId: "p0" }),
    ).toThrow(/disabled/);
  });
  it("emits ordered movement cues and same-player turn changes without revealing draws", () => {
    const s = play(fixture([["red:draw2", "green:8"], ["yellow:1"]]), "draw2");
    expect(s.animation.events.map((e) => e.kind)).toEqual([
      "play",
      "draw",
      "turn",
    ]);
    expect(s.animation.events[1]).toEqual({
      kind: "draw",
      playerId: "p1",
      count: 2,
    });
    expect(s.animation.events[2]).toMatchObject({
      playerId: "p0",
      previousPlayerId: "p0",
    });
    expect(s.turnSerial).toBeGreaterThan(0);
  });
  it("conserves cards under combinations of house rules", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 0, max: 100000 }),
        (stack, until, must, seed) => {
          let s = started(4, seed);
          s.rules = {
            ...classicRules,
            stackDrawTwo: stack,
            drawUntilPlayable: until,
            mustPlayDrawn: must,
          };
          for (let i = 0; i < 350 && s.phase === "playing"; i++) {
            const id = currentPlayer(s).id;
            if (s.pendingWild)
              s = reduceGame(s, id, { type: "COLOR", color: "red" });
            else if (s.challenge)
              s = reduceGame(s, id, {
                type: "RESOLVE_CHALLENGE",
                challenge: i % 3 === 0,
              });
            else {
              const card = s.hands[id].find(
                (c) => canPlay(s, c) && (!s.hasDrawn || c.id === s.drawnCardId),
              );
              s = reduceGame(
                s,
                id,
                card
                  ? { type: "PLAY", cardId: card.id, color: "green", uno: true }
                  : { type: s.hasDrawn ? "PASS" : "DRAW" },
              );
            }
            expect(assertCardConservation(s)).toBe(true);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe("turn deadlines", () => {
  const expire = (s: GameState, now = s.turnDeadline!) =>
    reduceGame(
      s,
      s.ownerId,
      { type: "TIMEOUT", turnSerial: s.turnSerial, deadline: s.turnDeadline! },
      now,
    );
  it("defaults to 30 seconds; only the lobby owner can configure it and readiness resets", () => {
    let s = createLobby(player("p0"), 4);
    expect(s.turnTimeoutSeconds).toBe(30);
    s = reduceGame(s, "p1", { type: "JOIN", player: player("p1") });
    expect(() =>
      reduceGame(s, "p1", { type: "SET_TURN_TIMEOUT", seconds: 0 }),
    ).toThrow();
    s = reduceGame(s, "p0", { type: "SET_TURN_TIMEOUT", seconds: 0 });
    expect(s.turnTimeoutSeconds).toBe(0);
    expect(s.players.every((p) => !p.ready)).toBe(true);
    expect(() =>
      reduceGame(started(), "p0", { type: "SET_TURN_TIMEOUT", seconds: 60 }),
    ).toThrow();
  });
  it("expires exactly once, only at the deadline, without drawing or changing the hand", () => {
    const s = fixture([["red:1", "blue:2"], ["yellow:3"], ["green:4"]]);
    expect(s.turnDeadline).toBe(30000);
    expect(() => expire(s, 29999)).toThrow();
    expect(() =>
      reduceGame(
        s,
        "p1",
        { type: "TIMEOUT", turnSerial: s.turnSerial, deadline: 30000 },
        30000,
      ),
    ).toThrow();
    const next = expire(s);
    expect(next.turn).toBe(1);
    expect(next.hands).toEqual(s.hands);
    expect(next.turnDeadline).toBe(60000);
    expect(next.animation.events.at(-1)?.kind).toBe("turn");
    expect(() =>
      reduceGame(
        next,
        next.ownerId,
        { type: "TIMEOUT", turnSerial: s.turnSerial, deadline: 30000 },
        90000,
      ),
    ).toThrow();
  });
  it("does not extend the deadline after drawing, UNO, or a color decision", () => {
    const s = fixture([["red:1", "blue:2"], ["yellow:3"]]);
    const red = s.drawPile.findIndex((c) => c.color === "red");
    s.drawPile.push(s.drawPile.splice(red, 1)[0]);
    const drawn = reduceGame(s, "p0", { type: "DRAW" }, 29000);
    expect(drawn.turnDeadline).toBe(s.turnDeadline);
    drawn.rules.mustPlayDrawn = true;
    expect(expire(drawn).turn).toBe(1);
    s.unoVulnerable = "p1";
    expect(reduceGame(s, "p1", { type: "UNO" }, 12000).turnDeadline).toBe(
      30000,
    );
    s.pendingWild = { playerId: "p0", opening: true };
    expect(
      reduceGame(s, "p0", { type: "COLOR", color: "blue" }, 16000).turnDeadline,
    ).toBe(30000);
    expect(expire(s).pendingWild).toBeNull();
  });
  it("accepts pending draw penalties, including a winning Draw Four, before advancing", () => {
    let s = fixture([["red:draw2", "blue:2"], ["yellow:3"], ["green:4"]]);
    s.rules.stackDrawTwo = true;
    s = play(s, "draw2");
    const next = expire(s);
    expect(next.hands.p1).toHaveLength(3);
    expect(next.pendingDrawTwo).toBe(0);
    expect(next.turn).toBe(2);
    s = play(fixture([["null:wild4"], ["yellow:3"], ["green:4"]]), "wild4");
    const end = expire(s);
    expect(end.hands.p1).toHaveLength(5);
    expect(end.phase).toBe("round-over");
    expect(end.turnDeadline).toBeNull();
    expect(assertCardConservation(end)).toBe(true);
  });
  it("unlimited games never expire, and old snapshots retain unlimited behavior", () => {
    const s = fixture([["red:1", "blue:2"], ["yellow:3"]]);
    s.turnTimeoutSeconds = 0;
    s.turnDeadline = null;
    expect(() => expire(s, 999999)).toThrow();
    delete s.turnTimeoutSeconds;
    delete s.turnDeadline;
    expect(play(s, "1").turnDeadline).toBeNull();
  });
});
