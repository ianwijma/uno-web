"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { Copy, Check, ArrowRight, LoaderCircle, X } from "lucide-react";
import {
  Invite,
  inviteLink,
  newInvite,
  parseInvite,
} from "@/lib/network/invite";
import { GameSession } from "@/lib/network/session";
import { db, identityFor, tabKey } from "@/lib/network/storage";
import { useSession } from "@/lib/network/store";
import { classicRules, goalLabel, ruleOptions } from "@/lib/game/settings";
import { CardBack, PlayingCard } from "./card";
import { Dialog, DialogTitle } from "./dialog";
import { Lobby } from "./lobby";
import { Toaster } from "sonner";
import { ConnectionNotifications } from "./connection-notifications";
import { GameTable } from "./game-table";

function Rules({ onClose }: { onClose: () => void }) {
  const state = useSession((s) => s.state);
  const rules = state?.rules ?? classicRules;
  return (
    <Dialog labelId="rules-title" onClose={onClose} className="paper">
      <div className="paper-heading">
        <DialogTitle id="rules-title">The rulebook</DialogTitle>
        <button
          className="icon-button"
          aria-label="Close rules"
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </div>
      <p>
        Match the color, number, or symbol. You can draw instead of playing.
        Only the newly drawn card can be played after a draw.
      </p>
      <p>
        Skip and Reverse let you go again with two players. Draw Two makes the
        next player draw two and miss a turn, unless stacking is enabled.
      </p>
      <p>
        A Wild Draw Four is legal only when you have no card in the active
        color. Bluffing is allowed: a successful challenge makes the offender
        draw four; a failed challenge makes the challenger draw six.
      </p>
      <h3>This table’s rules</h3>
      <ul className="rulebook-list">
        {ruleOptions.map((rule) => (
          <li key={rule.key}>
            <strong>
              {rules[rule.key] ? "On" : "Off"} · {rule.title}
            </strong>
            <span>{rule.description}</span>
          </li>
        ))}
      </ul>
      <p>
        <strong>
          {goalLabel(state?.goal ?? { mode: "points", target: 500 })}.
        </strong>{" "}
        Number cards score face value, action cards 20, and wilds 50. Winning a
        round adds one round win.
      </p>
      <p className="field-hint">
        Classic 108-card edition.{" "}
        <a
          href="https://service.mattel.com/instruction_sheets/UNO%20Basic%20IS.pdf"
          target="_blank"
          rel="noreferrer"
        >
          Original Mattel rules ↗
        </a>
      </p>
    </Dialog>
  );
}
export function UnoApp() {
  const [session, setSession] = useState<GameSession | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [name, setName] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [starting, setStarting] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const sessionRef = useRef<GameSession | null>(null);
  const view = useSession();
  useEffect(() => {
    let cancelled = false;
    let restored: GameSession | null = null;
    void (async () => {
      try {
        const savedName = localStorage.getItem("uno-name-v1") ?? "";
        startTransition(() => setName(savedName));
        if (!window.location.hash) return;
        const link = parseInvite(window.location.href);
        startTransition(() => {
          setInvite(link);
          setInviteInput(window.location.href);
        });
        const key = sessionStorage.getItem("uno-tab-v1");
        if (!key || sessionStorage.getItem(`uno-left:${link.room}`)) return;
        const [identity, saved] = await Promise.all([
          db.identities.get(key),
          db.journals.get(`${key}:${link.room}`),
        ]);
        if (cancelled || !identity || !saved?.committed) return;
        const player = saved.committed.state.players.find(
          (p) => p.id === identity.id,
        );
        if (!player) return;
        restored = new GameSession(link, identity, player.name);
        sessionRef.current = restored;
        await restored.open();
        if (cancelled) return;
        setName(player.name);
        setSession(restored);
      } catch (e) {
        if (!cancelled) {
          restored?.close();
          sessionRef.current = null;
          setError(
            e instanceof Error
              ? e.message
              : "Could not restore your table. Join again to retry.",
          );
        }
      } finally {
        if (!cancelled) setInitialized(true);
      }
    })();
    return () => {
      cancelled = true;
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, []);
  async function connect(create: boolean) {
    setError(null);
    if (!name.trim()) {
      setError("Enter a display name to take your seat.");
      return;
    }
    if (!window.isSecureContext) {
      setError("Open the game over HTTPS or localhost to connect.");
      return;
    }
    setStarting(true);
    let next: GameSession | null = null;
    try {
      const identity = await identityFor(tabKey());
      const link = create
        ? newInvite(identity.id, "nostr")
        : parseInvite(inviteInput);
      next = new GameSession(link, identity, name.trim());
      sessionRef.current = next;
      await next.open(create ? 6 : undefined);
      localStorage.setItem("uno-name-v1", name.trim());
      sessionStorage.removeItem(`uno-left:${link.room}`);
      window.history.replaceState(null, "", inviteLink(link));
      setInvite(link);
      setSession(next);
    } catch (e) {
      next?.close();
      sessionRef.current = null;
      setError(
        e instanceof Error ? e.message : "Could not connect to this table.",
      );
    } finally {
      setStarting(false);
    }
  }
  function leave() {
    if (invite) sessionStorage.setItem(`uno-left:${invite.room}`, "1");
    sessionRef.current?.close();
    sessionRef.current = null;
    setSession(null);
    if (invite) setInviteInput(inviteLink(invite));
  }
  async function copyInvite() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(inviteLink(invite));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        "Copy the invite from your address bar; clipboard access is unavailable.",
      );
    }
  }
  async function changeNetwork(network: Invite["network"]) {
    if (!session || !invite) return;
    try {
      await session.changeNetwork(network);
      const next = { ...invite, network };
      setInvite(next);
      window.history.replaceState(null, "", inviteLink(next));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not change the connection.",
      );
    }
  }
  const state = view.state;
  return (
    <main
      className={`app-shell ${session && state?.phase !== "lobby" ? "in-game" : ""} selection:bg-amber-200 selection:text-stone-900`}
    >
      <header className="site-header">
        <button
          className="brand"
          disabled={starting}
          onClick={() => {
            leave();
            setInvite(null);
            setInviteInput("");
            window.history.replaceState(null, "", "/");
          }}
          aria-label="UNO Web home"
        >
          <span className="brand-cards" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            UNO<span className="brand-sub">THE FRIENDS’ TABLE</span>
          </span>
        </button>
        <div className="header-actions">
          {session ? (
            <span className={`connection-status ${view.status}`}>
              <i />
              {statusText(view.status)}
              {view.busy ? " · confirming" : ""}
            </span>
          ) : (
            <span className="header-caption">
              Bring your people. We’ll bring the cards.
            </span>
          )}
          <button className="text-button" onClick={() => setRulesOpen(true)}>
            How to play
          </button>
        </div>
      </header>
      {!initialized ? (
        <section className="loading-table paper" role="status">
          <LoaderCircle className="spin" />
          <h2>Returning to your table…</h2>
        </section>
      ) : !session ? (
        <section className="welcome-table wood-frame">
          <div className="welcome-felt">
            <div className="welcome-art" aria-hidden="true">
              <span className="felt-lettering">
                THE GOOD OLD
                <br />
                GAME NIGHT.
              </span>
              <div className="scattered-cards">
                <PlayingCard
                  card={{ id: "hero-1", color: "red", value: "7" }}
                />
                <PlayingCard
                  card={{ id: "hero-2", color: "yellow", value: "reverse" }}
                />
                <CardBack />
              </div>
              <span className="pencil-note">Just one more round.</span>
              <span className="loose-token one" />
              <span className="loose-token two" />
            </div>
            <section className="paper welcome-slip">
              <span className="eyebrow">YOU’RE ON THE GUEST LIST</span>
              <h1>Take a seat.</h1>
              <p>
                A private table for your favorite people.
                <br />
                Set the rules together once you’re in.
              </p>
              <label className="field-label" htmlFor="name">
                Your display name
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name on the scorepad"
                autoComplete="nickname"
                maxLength={24}
                disabled={starting || !initialized}
              />
              <button
                className="red-button full"
                disabled={starting || !initialized}
                onClick={() => void connect(true)}
              >
                {starting ? <LoaderCircle className="spin" size={18} /> : null}
                Create a lobby <ArrowRight size={18} />
              </button>
              <div className="pencil-divider">or join your friends</div>
              <label className="field-label" htmlFor="invite">
                Invite link
              </label>
              <input
                id="invite"
                type="url"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                placeholder="Paste the table’s invite"
                disabled={starting || !initialized}
              />
              <button
                className="ink-button full"
                disabled={starting || !initialized || !inviteInput}
                onClick={() => void connect(false)}
              >
                Join a lobby <ArrowRight size={18} />
              </button>
              <p className="slip-footnote">
                2–12 people · No accounts · Your own table
              </p>
              {error ? (
                <p className="error-box" role="alert">
                  {error}
                </p>
              ) : null}
            </section>
          </div>
        </section>
      ) : (
        <div className="session-layout">
          <div className="session-toolbar">
            <span className="table-stamp">
              {invite?.network === "local"
                ? "AT HOME · BROWSER TABLE"
                : "GAME NIGHT · PRIVATE TABLE"}
            </span>
            <div className="toolbar-buttons">
              <button className="text-button" onClick={() => void copyInvite()}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Invite friends"}
              </button>
              <button className="text-button" onClick={leave}>
                Leave table
              </button>
            </div>
          </div>
          {error || view.error ? (
            <div className="error-box" role="alert">
              {error ?? view.error}
              <button
                className="text-button"
                onClick={() => {
                  setError(null);
                  session.clearError();
                }}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {!state ? (
            <div className="loading-table paper">
              <LoaderCircle size={28} className="spin" />
              <h2>Finding your table…</h2>
              <p>Keep the host’s tab open while everyone arrives.</p>
              <p className="field-hint">
                Browser-only invites work in tabs on the same browser. Some
                networks need a TURN relay for online play.
              </p>
            </div>
          ) : state.phase === "lobby" ? (
            <Lobby
              state={state}
              session={session}
              invite={invite!}
              onCopy={() => void copyInvite()}
              copied={copied}
              onNetworkChange={(network) => void changeNetwork(network)}
            />
          ) : state.players.some((p) => p.id === view.selfId) ? (
            <GameTable state={state} session={session} />
          ) : (
            <p className="connection-notice">
              This table is already playing. Ask your friends for a new lobby.
            </p>
          )}
        </div>
      )}
      <footer className="site-footer">
        <span>GOOD COMPANY. QUESTIONABLE STRATEGY.</span>
        <span>Uno Web · A game night, wherever you are.</span>
      </footer>
      <Toaster
        position="bottom-right"
        duration={4500}
        visibleToasts={2}
        closeButton
        richColors
      />
      {session ? <ConnectionNotifications key={invite?.room} /> : null}
      {rulesOpen ? <Rules onClose={() => setRulesOpen(false)} /> : null}
    </main>
  );
}
function statusText(status: string) {
  return (
    {
      connecting: "Connecting",
      waiting: "Waiting for a seat",
      connected: "Connected",
      electing: "Finding a new host",
      paused: "Table paused",
      closed: "Disconnected",
    } as Record<string, string>
  )[status];
}
