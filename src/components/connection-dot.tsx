"use client";
import { useSession } from "@/lib/network/store";
export function ConnectionDot({
  playerId,
  name,
}: {
  playerId: string;
  name: string;
}) {
  const health = useSession((s) => s.health[playerId] ?? "flaky");
  const label = {
    stable: "Stable connection",
    flaky: "Unstable connection",
    offline: "Offline",
  }[health];
  return (
    <span
      className={`connection-dot ${health}`}
      role="img"
      aria-label={`${name}: ${label}`}
      title={label}
      data-health={health}
    />
  );
}
