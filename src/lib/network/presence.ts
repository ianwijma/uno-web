export type PeerHealth = "stable" | "flaky" | "offline";
/** Display health is deliberately more tolerant than the authority lease.
 * Every authenticated packet is activity, including commands addressed to others.
 */
export function peerHealth(
  lastSeen: number | undefined,
  now: number,
  discoveredAt = now,
): PeerHealth {
  if (lastSeen === undefined)
    return now - discoveredAt > 12000 ? "offline" : "flaky";
  const age = Math.max(0, now - lastSeen);
  return age <= 4500 ? "stable" : age <= 12000 ? "flaky" : "offline";
}
