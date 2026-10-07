import { create } from "zustand";
import { GameState } from "../game/types";
export type ConnectionStatus =
  "connecting" | "waiting" | "connected" | "electing" | "paused" | "closed";
export interface SessionView {
  state: GameState | null;
  selfId: string;
  leaderId: string | null;
  status: ConnectionStatus;
  online: string[];
  revision: number;
  busy: boolean;
  error: string | null;
}
export const useSession = create<SessionView>(() => ({
  state: null,
  selfId: "",
  leaderId: null,
  status: "closed",
  online: [],
  revision: 0,
  busy: false,
  error: null,
}));
