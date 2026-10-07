import Dexie, { type EntityTable } from "dexie";
import { Frame } from "./protocol";

export type Identity = {
  key: string;
  id: string;
  publicKey: string;
  privateKey: JsonWebKey;
};
export type Journal = {
  key: string;
  term: number;
  votedFor: string | null;
  leaderId: string | null;
  committed: Frame | null;
  accepted: Frame | null;
  before: string[];
  after: string[];
};
const db = new Dexie("uno-web-v1") as Dexie & {
  identities: EntityTable<Identity, "key">;
  journals: EntityTable<Journal, "key">;
};
db.version(1).stores({ identities: "key", journals: "key" });
export { db };
export function tabKey(): string {
  let key = sessionStorage.getItem("uno-tab-v1");
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem("uno-tab-v1", key);
  }
  return key;
}
export function encode(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
export function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export async function identityFor(key: string): Promise<Identity> {
  const saved = await db.identities.get(key);
  if (saved) return saved;
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const hash = await crypto.subtle.digest("SHA-256", raw);
  const identity = {
    key,
    id: Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
    publicKey: encode(raw),
    privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
  await db.identities.put(identity);
  return identity;
}
