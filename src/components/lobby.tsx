"use client";
import { Check, Copy, Crown, Settings2, Users } from "lucide-react";
import { GameState } from "@/lib/game/types";
import {
  classicRules,
  goalLabel,
  isClassic,
  playerColors,
  ruleOptions,
} from "@/lib/game/settings";
import { GameSession } from "@/lib/network/session";
import { useSession } from "@/lib/network/store";
import { Invite } from "@/lib/network/invite";
import { PlayerToken } from "./player-token";

export function Lobby({
  state,
  session,
  invite,
  onCopy,
  copied,
  onNetworkChange,
}: {
  state: GameState;
  session: GameSession;
  invite: Invite;
  onCopy: () => void;
  copied: boolean;
  onNetworkChange: (network: Invite["network"]) => void;
}) {
  const view = useSession();
  const self = state.players.find((p) => p.id === view.selfId);
  const owner = state.ownerId === view.selfId;
  const enabled = view.status === "connected" && !view.busy;
  const allReady =
    state.players.length >= 2 &&
    state.players.every(
      (p) => p.ready && p.color && view.online.includes(p.id),
    );
  const selectedColor = playerColors.find((c) => c.id === self?.color);
  return (
    <div className="lobby-layout">
      <section className="lobby-table wood-frame">
        <div className="lobby-felt">
          <div className="table-title">
            <span className="table-stamp">PULL UP A CHAIR</span>
            <h1>Game night starts here.</h1>
            <p>Pick a playing piece. Invite the usual suspects.</p>
          </div>
          <div className="seats-count">
            <Users size={17} />
            <span>
              {state.players.length}/{state.maxPlayers}
            </span>{" "}
            at the table
          </div>
          <div className="player-seats">
            {state.players.map((player) => (
              <article className="lobby-seat" key={player.id}>
                <PlayerToken player={player} />
                <div className="seat-name">
                  <strong>
                    {player.name}
                    {player.id === view.selfId ? " (you)" : ""}
                  </strong>
                  <span>
                    {player.id === state.ownerId ? "Table host" : "Player"}
                    {!view.online.includes(player.id) ? " · reconnecting" : ""}
                  </span>
                </div>
                {player.ready ? (
                  <span className="ready-label">
                    <Check size={14} /> Ready
                  </span>
                ) : (
                  <span className="seat-waiting">
                    {player.color ? "Settling in" : "Picking a piece"}
                  </span>
                )}
              </article>
            ))}
          </div>
          <div className="invite-slip">
            <span>There’s a seat with their name on it.</span>
            <button className="cream-button" onClick={onCopy}>
              <Copy size={15} />
              {copied ? "Link copied" : "Copy invite link"}
            </button>
          </div>
          {self ? (
            <fieldset className="color-tray">
              <legend>Your playing piece</legend>
              <p>
                {selectedColor
                  ? `${selectedColor.name} is yours.`
                  : "Choose one color. Every player gets their own."}
              </p>
              <div
                className="token-palette"
                role="group"
                aria-label="Player colors"
              >
                {playerColors.map((color) => {
                  const taken = state.players.find(
                    (p) => p.id !== self.id && p.color === color.id,
                  );
                  return (
                    <button
                      key={color.id}
                      className={`token-choice ${taken ? "taken" : ""}`}
                      style={{ backgroundColor: color.hex }}
                      aria-label={`Pick ${color.name}${taken ? ` · taken by ${taken.name}` : ""}`}
                      aria-pressed={self.color === color.id}
                      disabled={!enabled || !!taken}
                      title={
                        taken ? `${color.name} · ${taken.name}` : color.name
                      }
                      onClick={() =>
                        session.act({ type: "PICK_COLOR", color: color.id })
                      }
                    >
                      {self.color === color.id ? (
                        <Check size={19} strokeWidth={3} />
                      ) : taken ? (
                        <span aria-hidden="true">×</span>
                      ) : (
                        <span className="sr-only">{color.name}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <span className="color-caption">
                Taken pieces stay with their players, including after
                reconnecting.
              </span>
            </fieldset>
          ) : (
            <p className="waiting-admission">Waiting for your seat…</p>
          )}
          <div className="lobby-start">
            <button
              className={self?.ready ? "cream-button" : "red-button"}
              disabled={!enabled || !self?.color}
              onClick={() =>
                session.act({ type: "READY", ready: !self?.ready })
              }
            >
              <Check size={18} />
              {self?.ready ? "Unready" : "I’m ready"}
            </button>
            {owner ? (
              <button
                className="cream-button"
                disabled={!enabled || !allReady}
                onClick={() =>
                  session.act({
                    type: "START",
                    seed: crypto.getRandomValues(new Uint32Array(1))[0],
                  })
                }
              >
                Deal the cards <span aria-hidden="true">↗</span>
              </button>
            ) : (
              <p>The host deals when everyone is ready.</p>
            )}
          </div>
        </div>
      </section>
      <aside className="paper settings-sheet">
        <div className="paper-heading">
          <div>
            <span className="eyebrow">BEFORE WE DEAL</span>
            <h2>Table rules</h2>
          </div>
          <Settings2 size={23} />
        </div>
        <p className="sheet-note">
          {owner
            ? "Settle the rules here. No mid-game negotiations."
            : "The host sets the rules. Everyone plays by the same ones."}
        </p>
        <div className="settings-pair">
          <div>
            <label className="field-label" htmlFor="lobby-capacity">
              Seats at the table
            </label>
            <select
              id="lobby-capacity"
              value={state.maxPlayers}
              disabled={!owner || !enabled}
              onChange={(e) =>
                session.act({
                  type: "SET_CAPACITY",
                  max: Number(e.target.value),
                })
              }
            >
              {Array.from({ length: 11 }, (_, i) => i + 2)
                .filter((n) => n >= state.players.length)
                .map((n) => (
                  <option value={n} key={n}>
                    {n} players
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="network">
              Play together
            </label>
            <select
              id="network"
              value={invite.network}
              disabled={!owner || !enabled || state.players.length > 1}
              onChange={(e) =>
                onNetworkChange(e.target.value as Invite["network"])
              }
            >
              <option value="nostr">Across devices</option>
              <option value="local">On this browser</option>
            </select>
          </div>
        </div>
        <p className="field-hint">
          {invite.network === "local"
            ? "Open the invite in another tab on this browser."
            : "Share an invite to play with friends on other devices."}{" "}
          Choose the connection before anyone joins.
        </p>
        <label className="field-label" htmlFor="turn-timeout">
          Time per turn
        </label>
        <select
          id="turn-timeout"
          value={state.turnTimeoutSeconds ?? 0}
          disabled={!owner || !enabled}
          onChange={(e) =>
            session.act({
              type: "SET_TURN_TIMEOUT",
              seconds: Number(e.target.value) as 0 | 15 | 30 | 60 | 90 | 120,
            })
          }
        >
          {[0, 15, 30, 60, 90, 120].map((seconds) => (
            <option key={seconds} value={seconds}>
              {seconds ? `${seconds} seconds` : "Unlimited"}
            </option>
          ))}
        </select>
        <p className="field-hint">
          Time runs for the whole turn, including drawing and choosing a color.
          When it expires, the turn is skipped and any pending draw penalty is
          accepted. Reloading does not restart the clock.
        </p>
        <fieldset className="goal-settings">
          <legend>
            <Crown size={17} /> The winning goal
          </legend>
          <label className="field-label" htmlFor="goal-mode">
            Win by
          </label>
          <select
            id="goal-mode"
            value={state.goal.mode}
            disabled={!owner || !enabled}
            onChange={(e) =>
              session.act({
                type: "SET_GOAL",
                goal:
                  e.target.value === "rounds"
                    ? { mode: "rounds", target: 3 }
                    : { mode: "points", target: 500 },
              })
            }
          >
            <option value="points">Total points</option>
            <option value="rounds">Rounds won</option>
          </select>
          <label className="field-label" htmlFor="goal-target">
            {state.goal.mode === "points"
              ? "Points to win"
              : "Round wins to win"}
          </label>
          <select
            id="goal-target"
            value={state.goal.target}
            disabled={!owner || !enabled}
            onChange={(e) =>
              session.act({
                type: "SET_GOAL",
                goal: { ...state.goal, target: Number(e.target.value) },
              })
            }
          >
            {(state.goal.mode === "points"
              ? [50, 100, 200, 250, 500, 750, 1000, 2000, 5000]
              : Array.from({ length: 20 }, (_, i) => i + 1)
            ).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <p className="goal-summary">{goalLabel(state.goal)}.</p>
        </fieldset>
        <div className="house-heading">
          <h3>House rules</h3>
          <span className="ink-stamp">
            {isClassic(state.rules) ? "CLASSIC" : "HOUSE MIX"}
          </span>
        </div>
        <div className="rule-list">
          {ruleOptions.map((rule) => (
            <label className="rule-toggle" key={rule.key}>
              <span>
                <strong>{rule.title}</strong>
                <small>{rule.description}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label={rule.title}
                checked={state.rules[rule.key]}
                disabled={!owner || !enabled}
                onChange={(e) =>
                  session.act({
                    type: "SET_RULES",
                    rules: { ...state.rules, [rule.key]: e.target.checked },
                  })
                }
              />
              <span className="switch-track" aria-hidden="true" />
            </label>
          ))}
        </div>
        {owner && !isClassic(state.rules) ? (
          <button
            className="text-button"
            disabled={!enabled}
            onClick={() =>
              session.act({ type: "SET_RULES", rules: { ...classicRules } })
            }
          >
            Restore classic rules
          </button>
        ) : null}
        <p className="field-hint">
          Changes to rules or the goal reset everyone’s ready status.
          {state.maxPlayers > 10
            ? " 11–12 players extends the official 2–10 capacity."
            : " Classic 108-card deck."}
        </p>
      </aside>
    </div>
  );
}
