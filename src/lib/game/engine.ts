import {
  Card,
  Color,
  colors,
  GameAction,
  GameState,
  Player,
  TableEvent,
  TimeoutAction,
} from "./types";

import { classicRules, goalSchema, rulesSchema } from "./settings";

export class RuleError extends Error {}
function requireRule(ok: unknown, message: string): asserts ok {
  if (!ok) throw new RuleError(message);
}

export function createLobby(player: Player, maxPlayers: number): GameState {
  requireRule(
    maxPlayers >= 2 && maxPlayers <= 12 && Number.isInteger(maxPlayers),
    "Choose 2–12 seats.",
  );
  return {
    version: 2,
    phase: "lobby",
    ownerId: player.id,
    maxPlayers,
    rules: { ...classicRules },
    goal: { mode: "points", target: 500 },
    turnTimeoutSeconds: 30,
    turnDeadline: null,
    turnSerial: 0,
    pendingDrawTwo: 0,
    animation: { id: 0, events: [] },
    players: [player],
    hands: {},
    drawPile: [],
    discard: [],
    activeColor: "red",
    turn: 0,
    direction: 1,
    dealer: 0,
    drawnCardId: null,
    hasDrawn: false,
    pendingWild: null,
    challenge: null,
    unoVulnerable: null,
    unoCalled: [],
    winnerId: null,
    round: 0,
    rng: 1,
    message: "Invite your friends and get ready.",
  };
}

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  const add = (color: Color | null, value: Card["value"]) =>
    deck.push({ id: `c${deck.length}`, color, value });
  for (const color of colors) {
    add(color, "0");
    for (const value of [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "skip",
      "reverse",
      "draw2",
    ] as const) {
      add(color, value);
      add(color, value);
    }
  }
  for (let i = 0; i < 4; i++) {
    add(null, "wild");
    add(null, "wild4");
  }
  return deck;
}

// Deterministic randomness makes replicated transitions and recovery reproducible.
// The host seeds it with Web Crypto. Replicas are trusted, not cheat resistant.
function random(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(s: GameState, cards: Card[]): Card[] {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function draw(s: GameState, id: string, count: number): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (!s.drawPile.length && s.discard.length > 1) {
      const top = s.discard.pop()!;
      s.drawPile = shuffle(s, s.discard);
      s.discard = [top];
    }
    const card = s.drawPile.pop();
    if (!card) break; // All remaining cards can be in hands; never invent cards.
    s.hands[id].push(card);
    cards.push(card);
  }
  return cards;
}
export function currentPlayer(s: GameState): Player {
  return s.players[s.turn];
}
function advance(s: GameState, count = 1) {
  s.turnSerial++;
  s.turn =
    (s.turn + ((s.direction * count) % s.players.length) + s.players.length) %
    s.players.length;
  s.drawnCardId = null;
  s.hasDrawn = false;
}
export function canPlay(s: GameState, card: Card): boolean {
  if (s.pendingDrawTwo > 0) return card.value === "draw2";
  const top = s.discard.at(-1);
  return (
    !!top &&
    (card.color === null ||
      card.color === s.activeColor ||
      card.value === top.value)
  );
}
export function cardPoints(card: Card): number {
  return card.color === null
    ? 50
    : ["skip", "reverse", "draw2"].includes(card.value)
      ? 20
      : Number(card.value);
}
function finish(s: GameState, id: string) {
  if (s.hands[id].length || s.challenge || s.pendingWild || s.pendingDrawTwo)
    return;
  const winner = s.players.find((p) => p.id === id)!;
  const points = Object.entries(s.hands)
    .filter(([player]) => player !== id)
    .flatMap(([, hand]) => hand)
    .reduce((sum, card) => sum + cardPoints(card), 0);
  winner.score += points;
  winner.wins++;
  s.winnerId = id;
  s.phase =
    (s.goal.mode === "points" ? winner.score : winner.wins) >= s.goal.target
      ? "match-over"
      : "round-over";
  s.unoVulnerable = null;
  s.message = `${winner.name} wins the round and earns ${points} points!`;
}
function startRound(s: GameState, seed: number) {
  s.rng = seed >>> 0;
  s.turnSerial++;
  s.pendingDrawTwo = 0;
  s.round++;
  s.unoCalled = [];
  s.phase = "playing";
  s.winnerId = null;
  s.direction = 1;
  s.discard = [];
  s.challenge = null;
  s.pendingWild = null;
  s.unoVulnerable = null;
  s.hasDrawn = false;
  s.drawnCardId = null;
  const deck = makeDeck();
  if (s.round === 1) {
    let contenders = s.players.map((_, i) => i);
    // Dealer chosen by highest number; action cards count as zero. Redraw ties.
    while (contenders.length > 1) {
      const picks = shuffle(s, deck)
        .slice(0, contenders.length)
        .map((card) => (/^\d$/.test(card.value) ? Number(card.value) : 0));
      const high = Math.max(...picks);
      contenders = contenders.filter((_, i) => picks[i] === high);
    }
    s.dealer = contenders[0];
  } else s.dealer = (s.dealer + 1) % s.players.length;
  s.drawPile = shuffle(s, deck);
  s.hands = Object.fromEntries(s.players.map((p) => [p.id, []]));
  for (let i = 0; i < 7; i++) for (const p of s.players) draw(s, p.id, 1);
  let opening = s.drawPile.pop()!;
  while (opening.value === "wild4") {
    s.drawPile.unshift(opening);
    s.drawPile = shuffle(s, s.drawPile);
    opening = s.drawPile.pop()!;
  }
  s.discard = [opening];
  s.activeColor = opening.color ?? "red";
  s.turn = (s.dealer + 1) % s.players.length;
  if (opening.value === "skip") advance(s);
  if (opening.value === "draw2") {
    draw(s, currentPlayer(s).id, 2);
    advance(s);
  }
  if (opening.value === "reverse") {
    s.direction = -1;
    s.turn = s.dealer;
  }
  if (opening.value === "wild")
    s.pendingWild = { playerId: currentPlayer(s).id, opening: true };
  s.message = `Round ${s.round}. ${s.players[s.dealer].name} deals.`;
}

function applyAction(
  state: GameState,
  actorId: string,
  action: GameAction | TimeoutAction,
  now: number,
): GameState {
  const s = structuredClone(state);
  const actor = s.players.find((p) => p.id === actorId);
  if (action.type === "JOIN") {
    requireRule(
      s.phase === "lobby",
      "The match has started. Only existing players can reconnect.",
    );
    requireRule(action.player.id === actorId, "Invalid player identity.");
    if (actor) return s;
    requireRule(s.players.length < s.maxPlayers, "This lobby is full.");
    s.players.push({
      ...action.player,
      score: 0,
      wins: 0,
      ready: false,
      color: null,
    });
    s.message = `${action.player.name} joined the table.`;
    return s;
  }
  requireRule(actor, "You are not a player in this lobby.");
  if (action.type === "READY") {
    requireRule(s.phase === "lobby", "The match has already started.");
    requireRule(
      !action.ready || actor.color,
      "Pick your player color before getting ready.",
    );
    actor.ready = action.ready;
    return s;
  }
  if (action.type === "PICK_COLOR") {
    requireRule(
      s.phase === "lobby",
      "Player colors are locked during the match.",
    );
    requireRule(
      !s.players.some((p) => p.id !== actorId && p.color === action.color),
      "That player color is already taken.",
    );
    actor.color = action.color;
    actor.ready = false;
    return s;
  }
  if (
    action.type === "SET_RULES" ||
    action.type === "SET_GOAL" ||
    action.type === "SET_TURN_TIMEOUT"
  ) {
    requireRule(
      actorId === s.ownerId && s.phase === "lobby",
      "Only the lobby owner can change settings before play.",
    );
    if (action.type === "SET_RULES") s.rules = rulesSchema.parse(action.rules);
    else if (action.type === "SET_GOAL") s.goal = goalSchema.parse(action.goal);
    else {
      requireRule(
        [0, 15, 30, 60, 90, 120].includes(action.seconds),
        "Choose a supported turn timeout.",
      );
      s.turnTimeoutSeconds = action.seconds;
    }
    s.players.forEach((p) => {
      p.ready = false;
    });
    s.message = "Table settings changed. Everyone needs to ready up again.";
    return s;
  }
  if (action.type === "SET_CAPACITY") {
    requireRule(
      actorId === s.ownerId && s.phase === "lobby",
      "Only the lobby owner can change seats before play.",
    );
    requireRule(
      action.max >= s.players.length && action.max >= 2 && action.max <= 12,
      "Capacity cannot be below the current player count.",
    );
    s.maxPlayers = action.max;
    return s;
  }
  if (action.type === "START" || action.type === "NEXT_ROUND") {
    requireRule(
      actorId === s.ownerId,
      "Only the lobby owner can start a round.",
    );
    if (action.type === "START") {
      requireRule(
        s.phase === "lobby" && s.players.length >= 2,
        "At least two players are needed.",
      );
      requireRule(
        s.players.every((p) => p.ready && p.color),
        "Everyone must be ready.",
      );
    } else requireRule(s.phase === "round-over", "The round has not ended.");
    startRound(s, action.seed);
    return s;
  }
  requireRule(s.phase === "playing", "No round is in progress.");
  if (action.type === "TIMEOUT") {
    requireRule(
      actorId === s.ownerId,
      "Only the game master can expire a turn.",
    );
    requireRule(
      !!s.turnTimeoutSeconds &&
        s.turnDeadline != null &&
        action.turnSerial === s.turnSerial &&
        action.deadline === s.turnDeadline &&
        now >= s.turnDeadline,
      "This turn has not expired.",
    );
    const timedOut = currentPlayer(s);
    const offender = s.challenge?.offenderId;
    if (s.challenge) draw(s, timedOut.id, 4);
    else if (s.pendingDrawTwo) draw(s, timedOut.id, s.pendingDrawTwo);
    s.challenge = null;
    s.pendingDrawTwo = 0;
    // An opening wild has no chosen color yet; red is the displayed fallback.
    s.pendingWild = null;
    s.unoVulnerable = null;
    advance(s);
    s.message = `${timedOut.name} ran out of time and misses a turn.${offender ? " The Draw Four penalty is accepted." : ""}`;
    if (offender) finish(s, offender);
    return s;
  }
  if (action.type === "UNO") {
    requireRule(
      s.hands[actorId].length === 1 && !s.unoCalled?.includes(actorId),
      "There is no UNO declaration to make.",
    );
    if (s.unoVulnerable === actorId) s.unoVulnerable = null;
    s.unoCalled = [...(s.unoCalled ?? []), actorId];
    s.message = `${actor.name} calls UNO!`;
    return s;
  }
  if (action.type === "CATCH_UNO") {
    requireRule(
      s.rules.unoPenalty,
      "UNO catch penalties are disabled at this table.",
    );
    requireRule(
      action.playerId !== actorId && s.unoVulnerable === action.playerId,
      "That player cannot be caught now.",
    );
    draw(s, action.playerId, 2);
    s.unoVulnerable = null;
    s.message = `${actor.name} caught a missed UNO. Two-card penalty.`;
    return s;
  }
  if (action.type === "COLOR") {
    requireRule(
      s.pendingWild?.playerId === actorId,
      "You are not choosing a color.",
    );
    s.activeColor = action.color;
    s.pendingWild = null;
    return s;
  }
  requireRule(!s.pendingWild, "Choose a color first.");
  requireRule(currentPlayer(s).id === actorId, "It is not your turn.");
  if (action.type === "RESOLVE_CHALLENGE") {
    const pending = s.challenge;
    requireRule(
      pending && pending.targetId === actorId,
      "No Draw Four challenge is pending.",
    );
    s.unoVulnerable = null;
    if (action.challenge && pending.illegal) {
      draw(s, pending.offenderId, 4);
      s.message =
        "Challenge successful. The offender draws four; you keep your turn.";
    } else {
      draw(s, actorId, action.challenge ? 6 : 4);
      advance(s);
      s.message = action.challenge
        ? "Challenge failed. Six-card penalty."
        : `${actor.name} draws four and misses a turn.`;
    }
    s.challenge = null;
    finish(s, pending.offenderId);
    return s;
  }
  requireRule(!s.challenge, "Accept or challenge the Wild Draw Four first.");
  if (action.type === "DRAW") {
    requireRule(!s.hasDrawn, "You have already drawn this turn.");
    s.unoVulnerable = null;
    if (s.pendingDrawTwo) {
      const penalty = s.pendingDrawTwo;
      const received = draw(s, actorId, penalty).length;
      s.pendingDrawTwo = 0;
      advance(s);
      s.message = `${actor.name} takes ${received} cards from the +${penalty} stack and misses a turn.`;
      return s;
    }
    let card = draw(s, actorId, 1)[0];
    let count = card ? 1 : 0;
    // Bounded by the physical deck; stop cleanly when every available card is held.
    while (s.rules.drawUntilPlayable && card && !canPlay(s, card)) {
      const next = draw(s, actorId, 1)[0];
      if (!next) break;
      card = next;
      count++;
    }
    s.hasDrawn = true;
    s.drawnCardId = card?.id ?? null;
    s.message = `${actor.name} draws ${count === 1 ? "a card" : `${count} cards`}.`;
    if (!card || !canPlay(s, card)) advance(s);
    return s;
  }
  if (action.type === "PASS") {
    requireRule(s.hasDrawn, "Draw a card before passing.");
    requireRule(
      !s.rules.mustPlayDrawn,
      "This table requires you to play the drawn card.",
    );
    s.unoVulnerable = null;
    advance(s);
    return s;
  }
  if (action.type === "PLAY") {
    const hand = s.hands[actorId];
    const index = hand.findIndex((c) => c.id === action.cardId);
    requireRule(index >= 0, "That card is not in your hand.");
    const card = hand[index];
    requireRule(canPlay(s, card), "Match the color, number, or symbol.");
    requireRule(
      !s.hasDrawn || card.id === s.drawnCardId,
      "After drawing, only the drawn card can be played.",
    );
    requireRule(
      card.color !== null || action.color,
      "Choose a color for your wild card.",
    );
    s.unoVulnerable = null;
    const previousHand = [...hand];
    hand.splice(index, 1);
    s.discard.push(card);
    const previousColor = s.activeColor;
    s.activeColor = card.color ?? action.color!;
    if (s.rules.unoPenalty && hand.length === 1) s.unoVulnerable = actorId;
    s.message = `${actor.name} plays ${card.color ?? ""} ${card.value}.`;
    if (card.value === "reverse") {
      s.direction = s.direction === 1 ? -1 : 1;
      advance(s, s.players.length === 2 ? 2 : 1);
    } else if (card.value === "skip") advance(s, 2);
    else if (card.value === "draw2") {
      advance(s);
      if (s.rules.stackDrawTwo && hand.length > 0) {
        s.pendingDrawTwo += 2;
        s.message = `${actor.name} stacks Draw Two. ${currentPlayer(s).name}: stack another +2 or draw ${s.pendingDrawTwo}.`;
      } else {
        // A final +2 settles the whole stack before scoring; the round cannot
        // continue stacking after a player has gone out.
        draw(s, currentPlayer(s).id, s.pendingDrawTwo + 2);
        s.pendingDrawTwo = 0;
        advance(s);
      }
    } else if (card.value === "wild4") {
      // Illegal Draw Fours remain playable so the official bluff/challenge rule works.
      advance(s);
      s.challenge = {
        offenderId: actorId,
        targetId: currentPlayer(s).id,
        previousHand,
        illegal: previousHand.some((c) => c.color === previousColor),
      };
    } else advance(s);
    // The UNO window remains open until the next action, even if a two-player
    // action card gives this player another turn.
    finish(s, actorId);
    return s;
  }
  throw new RuleError("Unknown action.");
}

export function assertCardConservation(s: GameState): boolean {
  if (s.phase === "lobby") return true;
  const cards = [...s.drawPile, ...s.discard, ...Object.values(s.hands).flat()];
  return cards.length === 108 && new Set(cards.map((c) => c.id)).size === 108;
}

/** Public movement cues travel with each committed action, including after recovery.
 * Draw/deal events contain counts only: opponents always animate card backs.
 */
export function reduceGame(
  state: GameState,
  actorId: string,
  action: GameAction | TimeoutAction,
  now = 0,
): GameState {
  const next = applyAction(state, actorId, action, now);
  if (next.phase !== "playing") next.turnDeadline = null;
  else if (next.turnSerial !== state.turnSerial)
    next.turnDeadline = next.turnTimeoutSeconds
      ? now + next.turnTimeoutSeconds * 1000
      : null;
  next.unoCalled = (next.unoCalled ?? []).filter(
    (id) => next.hands[id]?.length === 1,
  );
  const events: TableEvent[] = [];
  const newRound = next.round !== state.round;
  if (newRound) {
    for (const player of next.players)
      events.push({
        kind: "deal",
        playerId: player.id,
        count: next.hands[player.id].length,
      });
  } else if (state.phase === "playing") {
    if (action.type === "PLAY") {
      const card = state.hands[actorId].find((c) => c.id === action.cardId);
      if (card) events.push({ kind: "play", playerId: actorId, card });
    }
    for (const player of next.players) {
      const oldIds = new Set(state.hands[player.id].map((c) => c.id));
      const count = next.hands[player.id].filter(
        (c) => !oldIds.has(c.id),
      ).length;
      if (count) events.push({ kind: "draw", playerId: player.id, count });
    }
  }
  if (next.phase === "playing" && next.turnSerial !== state.turnSerial) {
    events.push({
      kind: "turn",
      playerId: currentPlayer(next).id,
      previousPlayerId: newRound ? undefined : currentPlayer(state).id,
    });
  }
  next.animation = { id: state.animation.id + 1, events };
  return next;
}
