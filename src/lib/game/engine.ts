import { Card, Color, colors, GameAction, GameState, Player } from "./types";

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
    version: 1,
    phase: "lobby",
    ownerId: player.id,
    maxPlayers,
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
  s.turn =
    (s.turn + ((s.direction * count) % s.players.length) + s.players.length) %
    s.players.length;
  s.drawnCardId = null;
  s.hasDrawn = false;
}
export function canPlay(s: GameState, card: Card): boolean {
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
  if (s.hands[id].length || s.challenge || s.pendingWild) return;
  const winner = s.players.find((p) => p.id === id)!;
  const points = Object.entries(s.hands)
    .filter(([player]) => player !== id)
    .flatMap(([, hand]) => hand)
    .reduce((sum, card) => sum + cardPoints(card), 0);
  winner.score += points;
  s.winnerId = id;
  s.phase = winner.score >= 500 ? "match-over" : "round-over";
  s.unoVulnerable = null;
  s.message = `${winner.name} wins the round and earns ${points} points!`;
}
function startRound(s: GameState, seed: number) {
  s.rng = seed >>> 0;
  s.round++;
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

export function reduceGame(
  state: GameState,
  actorId: string,
  action: GameAction,
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
    s.players.push({ ...action.player, score: 0, ready: false });
    s.message = `${action.player.name} joined the table.`;
    return s;
  }
  requireRule(actor, "You are not a player in this lobby.");
  if (action.type === "READY") {
    requireRule(s.phase === "lobby", "The match has already started.");
    actor.ready = action.ready;
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
        s.players.every((p) => p.ready),
        "Everyone must be ready.",
      );
    } else requireRule(s.phase === "round-over", "The round has not ended.");
    startRound(s, action.seed);
    return s;
  }
  requireRule(s.phase === "playing", "No round is in progress.");
  if (action.type === "UNO") {
    requireRule(
      s.unoVulnerable === actorId && s.hands[actorId].length === 1,
      "There is no UNO declaration to make.",
    );
    s.unoVulnerable = null;
    s.message = `${actor.name} calls UNO!`;
    return s;
  }
  if (action.type === "CATCH_UNO") {
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
    const [card] = draw(s, actorId, 1);
    s.hasDrawn = true;
    s.drawnCardId = card?.id ?? null;
    s.message = `${actor.name} draws a card.`;
    if (!card || !canPlay(s, card)) advance(s);
    return s;
  }
  if (action.type === "PASS") {
    requireRule(s.hasDrawn, "Draw a card before passing.");
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
    if (hand.length === 1 && !action.uno) s.unoVulnerable = actorId;
    s.message = `${actor.name} plays ${card.color ?? ""} ${card.value}${action.uno && hand.length === 1 ? " and calls UNO!" : "."}`;
    if (card.value === "reverse") {
      s.direction = s.direction === 1 ? -1 : 1;
      advance(s, s.players.length === 2 ? 2 : 1);
    } else if (card.value === "skip") advance(s, 2);
    else if (card.value === "draw2") {
      advance(s);
      draw(s, currentPlayer(s).id, 2);
      advance(s);
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
    // With two players, skip/reverse/draw2 starts the same player's next turn.
    if (currentPlayer(s).id === actorId) s.unoVulnerable = null;
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
