import { z } from "zod";
import { goalSchema, playerColorSchema, rulesSchema } from "./settings";

export const colors = ["red", "yellow", "green", "blue"] as const;
export const colorSchema = z.enum(colors);
export type Color = z.infer<typeof colorSchema>;
export const cardSchema = z.object({
  id: z.string().max(32),
  color: colorSchema.nullable(),
  value: z.enum([
    "0",
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
    "wild",
    "wild4",
  ]),
});
export type Card = z.infer<typeof cardSchema>;
export const playerSchema = z.object({
  id: z.string().max(80),
  name: z.string().trim().min(1).max(24),
  ready: z.boolean(),
  score: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  color: playerColorSchema.nullable(),
});
export type Player = z.infer<typeof playerSchema>;
export const tableEventSchema = z.object({
  kind: z.enum(["play", "draw", "deal", "turn"]),
  playerId: z.string(),
  card: cardSchema.optional(),
  count: z.number().int().nonnegative().optional(),
  previousPlayerId: z.string().optional(),
});
export type TableEvent = z.infer<typeof tableEventSchema>;
export const gameSchema = z.object({
  version: z.literal(2),
  phase: z.enum(["lobby", "playing", "round-over", "match-over"]),
  ownerId: z.string(),
  maxPlayers: z.number().int().min(2).max(12),
  rules: rulesSchema,
  goal: goalSchema,
  turnSerial: z.number().int().nonnegative(),
  pendingDrawTwo: z.number().int().nonnegative(),
  animation: z.object({
    id: z.number().int().nonnegative(),
    events: z.array(tableEventSchema).max(24),
  }),
  players: z.array(playerSchema).min(1).max(12),
  hands: z.record(z.string(), z.array(cardSchema).max(108)),
  drawPile: z.array(cardSchema).max(108),
  discard: z.array(cardSchema).max(108),
  activeColor: colorSchema,
  turn: z.number().int().nonnegative(),
  direction: z.union([z.literal(1), z.literal(-1)]),
  dealer: z.number().int().nonnegative(),
  drawnCardId: z.string().nullable(),
  hasDrawn: z.boolean(),
  pendingWild: z
    .object({ playerId: z.string(), opening: z.boolean() })
    .nullable(),
  challenge: z
    .object({
      offenderId: z.string(),
      targetId: z.string(),
      previousHand: z.array(cardSchema),
      illegal: z.boolean(),
    })
    .nullable(),
  unoVulnerable: z.string().nullable(),
  winnerId: z.string().nullable(),
  round: z.number().int().nonnegative(),
  rng: z.number().int().nonnegative(),
  message: z.string().max(300),
});
export type GameState = z.infer<typeof gameSchema>;
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("JOIN"), player: playerSchema }),
  z.object({ type: z.literal("READY"), ready: z.boolean() }),
  z.object({ type: z.literal("PICK_COLOR"), color: playerColorSchema }),
  z.object({ type: z.literal("SET_RULES"), rules: rulesSchema }),
  z.object({ type: z.literal("SET_GOAL"), goal: goalSchema }),
  z.object({
    type: z.literal("SET_CAPACITY"),
    max: z.number().int().min(2).max(12),
  }),
  z.object({ type: z.literal("START"), seed: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("PLAY"),
    cardId: z.string(),
    color: colorSchema.optional(),
    uno: z.boolean().optional(),
  }),
  z.object({ type: z.literal("DRAW") }),
  z.object({ type: z.literal("PASS") }),
  z.object({ type: z.literal("COLOR"), color: colorSchema }),
  z.object({ type: z.literal("UNO") }),
  z.object({ type: z.literal("CATCH_UNO"), playerId: z.string() }),
  z.object({ type: z.literal("RESOLVE_CHALLENGE"), challenge: z.boolean() }),
  z.object({
    type: z.literal("NEXT_ROUND"),
    seed: z.number().int().nonnegative(),
  }),
]);
export type GameAction = z.infer<typeof actionSchema>;
