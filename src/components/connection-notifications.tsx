"use client";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSession } from "@/lib/network/store";
import { PeerHealth } from "@/lib/network/presence";

export function ConnectionNotifications() {
  const { status, state, health, selfId, networkNotice } = useSession();
  const previous = useRef<{
    connected: boolean;
    lost: boolean;
    owner: string | null;
    health: Record<string, PeerHealth>;
  }>({ connected: false, lost: false, owner: null, health: {} });
  useEffect(() => {
    const prev = previous.current;
    if (status === "connected") {
      if (prev.lost)
        toast.success("Connection restored. You’re back at the table.", {
          id: "table-connection",
        });
      prev.connected = true;
      prev.lost = false;
    } else if (
      prev.connected &&
      !prev.lost &&
      (status === "paused" || status === "electing")
    ) {
      toast.warning("Connection lost. Reconnecting to the table…", {
        id: "table-connection",
      });
      prev.lost = true;
    }
    const owner = state?.ownerId ?? null;
    if (owner && prev.owner && owner !== prev.owner) {
      const name =
        state?.players.find((p) => p.id === owner)?.name ?? "Another player";
      toast.info(
        owner === selfId
          ? "You’re the new game master."
          : `${name} is the new game master.`,
        { id: "game-master" },
      );
    }
    prev.owner = owner;
    for (const player of state?.players ?? []) {
      if (player.id === selfId || status !== "connected") continue;
      const before = prev.health[player.id];
      const after = health[player.id];
      if (before && before !== "offline" && after === "offline")
        toast.warning(`${player.name} lost connection.`, {
          id: `peer-${player.id}`,
        });
      else if (before === "offline" && after && after !== "offline")
        toast.success(`${player.name} reconnected.`, {
          id: `peer-${player.id}`,
        });
    }
    prev.health = health;
  }, [status, state, health, selfId]);
  useEffect(() => {
    if (networkNotice)
      toast.warning(networkNotice.message, { id: "network-notice" });
  }, [networkNotice]);
  return null;
}
