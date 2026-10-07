import { z } from "zod";
const inviteSchema = z.object({
  v: z.literal("1"),
  room: z.string().uuid(),
  key: z.string().regex(/^[a-f0-9]{64}$/),
  founder: z.string().regex(/^[a-f0-9]{64}$/),
  network: z.enum(["nostr", "local"]),
});
export type Invite = z.infer<typeof inviteSchema>;
export function parseInvite(input: string): Invite {
  const url = new URL(input, window.location.origin);
  return inviteSchema.parse(
    Object.fromEntries(new URLSearchParams(url.hash.slice(1))),
  );
}
export function inviteLink(invite: Invite): string {
  return `${window.location.origin}/#${new URLSearchParams(invite).toString()}`;
}
export function newInvite(founder: string, network: Invite["network"]): Invite {
  return {
    v: "1",
    room: crypto.randomUUID(),
    founder,
    network,
    key: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
