import type { CSSProperties } from "react";
import { colorHex } from "@/lib/game/settings";
import type { Player } from "@/lib/game/types";
export function PlayerToken({
  player,
  small = false,
}: {
  player: Player;
  small?: boolean;
}) {
  return (
    <span
      className={`player-token ${small ? "small" : ""}`}
      style={{ "--token": colorHex(player.color) } as CSSProperties}
      aria-hidden="true"
    >
      <span>{player.name.slice(0, 1).toUpperCase()}</span>
    </span>
  );
}
