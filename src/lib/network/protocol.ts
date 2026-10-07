import { z } from "zod";
import stringify from "fast-json-stable-stringify";
export const canonical = stringify;
import { actionSchema, gameSchema } from "../game/types";

export const frameSchema = z.object({
  index: z.number().int().nonnegative(),
  term: z.number().int().positive(),
  hash: z.string().length(64),
  state: gameSchema,
});
export type Frame = z.infer<typeof frameSchema>;
export const messageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("HELLO"),
    name: z.string().trim().min(1).max(24),
  }),
  z.object({
    type: z.literal("STATE"),
    frame: frameSchema,
    term: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("COMMAND"),
    id: z.string().max(80),
    revision: z.number().int(),
    action: actionSchema,
  }),
  z.object({
    type: z.literal("PROPOSE"),
    frame: frameSchema,
    before: z.array(z.string()).min(1).max(12),
    after: z.array(z.string()).min(1).max(12),
    term: z.number().int().positive(),
    requestId: z.string().max(80),
  }),
  z.object({
    type: z.literal("ACK"),
    hash: z.string(),
    term: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("COMMIT"),
    hash: z.string(),
    term: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("HEARTBEAT"),
    term: z.number().int().positive(),
    index: z.number().int().nonnegative(),
    hash: z.string(),
  }),
  z.object({ type: z.literal("REQUEST_STATE") }),
  z.object({
    type: z.literal("VOTE_REQUEST"),
    term: z.number().int().positive(),
    lastTerm: z.number().int(),
    lastIndex: z.number().int(),
  }),
  z.object({ type: z.literal("VOTE"), term: z.number().int().positive() }),
  z.object({
    type: z.literal("LEADER"),
    term: z.number().int().positive(),
    voters: z.array(z.string()).max(12),
  }),
  z.object({ type: z.literal("ERROR"), message: z.string().max(300) }),
]);
export type Message = z.infer<typeof messageSchema>;
export const envelopeSchema = z.object({
  room: z.string().max(80),
  from: z.string().length(64),
  to: z.string().optional(),
  publicKey: z.string().max(200),
  signature: z.string().max(200),
  message: messageSchema,
});
export type Envelope = z.infer<typeof envelopeSchema>;
export function hasMajority(
  voters: Iterable<string>,
  members: string[],
): boolean {
  const votes = new Set(voters);
  return (
    members.filter((id) => votes.has(id)).length >=
    Math.floor(members.length / 2) + 1
  );
}
export function jointMajority(
  voters: Iterable<string>,
  before: string[],
  after: string[],
): boolean {
  const ids = [...voters];
  return hasMajority(ids, before) && hasMajority(ids, after);
}
export function isLogCurrent(
  candidate: { term: number; index: number },
  local: { term: number; index: number },
): boolean {
  return (
    candidate.term > local.term ||
    (candidate.term === local.term && candidate.index >= local.index)
  );
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function makeFrame(
  state: Frame["state"],
  index: number,
  term: number,
): Promise<Frame> {
  return { state, index, term, hash: await digest({ state, index, term }) };
}
export async function validFrame(frame: Frame): Promise<boolean> {
  return (
    frame.hash ===
    (await digest({ state: frame.state, index: frame.index, term: frame.term }))
  );
}
