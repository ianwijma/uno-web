"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  Copy,
  Crown,
  Link as LinkIcon,
  LoaderCircle,
  Plus,
  Radio,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { canPlay, currentPlayer } from "@/lib/game/engine";
import { Card, Color, GameState } from "@/lib/game/types";
import {
  Invite,
  inviteLink,
  newInvite,
  parseInvite,
} from "@/lib/network/invite";
import { GameSession } from "@/lib/network/session";
import { identityFor, tabKey } from "@/lib/network/storage";
import { useSession } from "@/lib/network/store";
import { CardBack, ColorPicker, PlayingCard } from "./card";
import { Dialog } from "./dialog";

function Brand({ onHome }: { onHome: () => void }) {
  return (
    <button className="brand" onClick={onHome} aria-label="UNO Web home">
      <span className="brand-mark">U</span>
      <span>
        uno<span className="brand-web"> web</span>
      </span>
    </button>
  );
}
function Rules({ onClose }: { onClose: () => void }) {
  return (
    <Dialog labelId="rules-title" onClose={onClose}>
      <div className="section-heading">
        <h2 id="rules-title">The classic rules.</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close rules"
          autoFocus
        >
          <X size={20} />
        </button>
      </div>
      <p>
        Match the color, number, or symbol. You may draw instead of playing.
        After drawing, only the new card can be played.
      </p>
      <p>
        Draw Two means draw two and miss a turn. Draw Four means draw four and
        miss a turn, unless challenged. There is no stacking.
      </p>
      <p>
        A Wild Draw Four is legal only if you have no card in the active color.
        You can bluff: a successful challenge makes the offender draw four; a
        failed challenge makes you draw six.
      </p>
      <p>
        Call UNO as you reach one card. If another player catches you before the
        next turn begins, draw two. Use “Call UNO with my play” to declare it
        together with your card.
      </p>
      <p>
        Skip and Reverse let you play again with two players. Win rounds to
        collect points: number cards at face value, action cards 20, wilds 50.
        First to 500 wins.
      </p>
      <p className="muted">
        Classic 108-card edition. Official capacity is 2–10; 11–12 seats is an
        extension.{" "}
        <a
          href="https://service.mattel.com/instruction_sheets/UNO%20Basic%20IS.pdf"
          target="_blank"
          rel="noreferrer"
        >
          Mattel rule sheet ↗
        </a>
      </p>
    </Dialog>
  );
}

export function UnoApp() {
  const [session, setSession] = useState<GameSession | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [name, setName] = useState("");
  const [max, setMax] = useState(6);
  const [network, setNetwork] = useState<Invite["network"]>("nostr");
  const [inviteInput, setInviteInput] = useState("");
  const [starting, setStarting] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [copied, setCopied] = useState(false);
  const sessionRef = useRef<GameSession | null>(null);
  const view = useSession();

  useEffect(() => {
    startTransition(() => {
      const remembered = localStorage.getItem("uno-name-v1");
      if (remembered) setName(remembered);
      if (window.location.hash) {
        try {
          const parsed = parseInvite(window.location.href);
          setInvite(parsed);
          setInviteInput(window.location.href);
        } catch {
          setError("That invite link is invalid or uses a different version.");
        }
      }
      setInitialized(true);
    });
    return () => sessionRef.current?.close();
  }, []);
  useEffect(() => {
    if (!showRules) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowRules(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [showRules]);

  async function connect(create: boolean) {
    setError(null);
    if (!name.trim()) {
      setError("Enter a display name to take your seat.");
      return;
    }
    if (!window.isSecureContext) {
      setError("Open this app over HTTPS or localhost to use browser P2P.");
      return;
    }
    setStarting(true);
    let next: GameSession | null = null;
    try {
      const identity = await identityFor(tabKey());
      const link = create
        ? newInvite(identity.id, network)
        : parseInvite(inviteInput);
      next = new GameSession(link, identity, name.trim());
      sessionRef.current = next;
      await next.open(create ? max : undefined);
      localStorage.setItem("uno-name-v1", name.trim());
      window.history.replaceState(null, "", inviteLink(link));
      setInvite(link);
      setSession(next);
    } catch (cause) {
      next?.close();
      sessionRef.current = null;
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not connect to this lobby.",
      );
    } finally {
      setStarting(false);
    }
  }
  function leave() {
    session?.close();
    sessionRef.current = null;
    setSession(null);
    // Preserve the invite so returning in the same tab restores the same seat.
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
        "Clipboard access failed. Copy the invite from your address bar.",
      );
    }
  }
  const state = view.state;
  const self = state?.players.find((p) => p.id === view.selfId);

  return (
    <main className="app-shell selection:bg-lime-200 selection:text-green-950">
      <header className="site-header">
        <Brand
          onHome={() => {
            leave();
            setInvite(null);
            setInviteInput("");
            window.history.replaceState(null, "", "/");
          }}
        />
        <div className="header-actions">
          <span className="local-label">
            <span className="status-dot" /> Browser-owned games
          </span>
          <button className="text-button" onClick={() => setShowRules(true)}>
            How to play
          </button>
        </div>
      </header>
      {!session ? (
        <div className="landing">
          <section className="hero">
            <div className="eyebrow">
              <span className="status-dot" /> YOUR FRIENDS. YOUR TABLE.
            </div>
            <h1>
              One more
              <br />
              round<span className="accent">.</span>
            </h1>
            <p className="hero-copy">
              The classic card game, a little closer.
              <br />
              Make a table, send a link, and let the friendly rivalry begin.
            </p>
            <div className="hero-cards" aria-hidden="true">
              <PlayingCard
                card={{ id: "art-1", color: "blue", value: "reverse" }}
              />
              <PlayingCard card={{ id: "art-2", color: "red", value: "7" }} />
              <PlayingCard
                card={{ id: "art-3", color: null, value: "wild4" }}
              />
            </div>
            <div className="feature-row">
              <span>
                <Users size={17} /> 2–12 friends
              </span>
              <span>
                <ShieldCheck size={17} /> No accounts
              </span>
              <span>
                <Radio size={17} /> Peer to peer
              </span>
            </div>
          </section>
          <section className="entry-panel">
            <div className="eyebrow">SAVE A SEAT</div>
            <h2>
              {inviteInput ? "You’re invited." : "Bring everyone together."}
            </h2>
            <p className="muted">
              All you need is a name and a little competitive spirit.
            </p>
            <label className="field-label" htmlFor="name">
              Your display name
            </label>
            <input
              id="name"
              placeholder="What should we call you?"
              value={name}
              maxLength={24}
              autoComplete="nickname"
              onChange={(e) => setName(e.target.value)}
              disabled={starting || !initialized}
            />
            <div className="create-options">
              <div>
                <label className="field-label" htmlFor="capacity">
                  Seats at the table
                </label>
                <select
                  id="capacity"
                  value={max}
                  onChange={(e) => setMax(Number(e.target.value))}
                  disabled={starting || !initialized}
                >
                  {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                    <option key={n} value={n}>
                      {n} players{n > 10 ? " · extended" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="network">
                  Connection
                </label>
                <select
                  id="network"
                  value={network}
                  onChange={(e) =>
                    setNetwork(e.target.value as Invite["network"])
                  }
                  disabled={starting || !initialized}
                >
                  <option value="nostr">Online · P2P</option>
                  <option value="local">Local · browser tabs</option>
                </select>
              </div>
            </div>
            <button
              className="primary-button full"
              onClick={() => void connect(true)}
              disabled={starting || !initialized}
            >
              {starting ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Plus size={18} />
              )}{" "}
              Create a lobby <ArrowRight size={18} />
            </button>
            <div className="divider">
              <span>already have a table?</span>
            </div>
            <label className="field-label" htmlFor="invite">
              Invite link
            </label>
            <div className="input-icon">
              <LinkIcon size={18} />
              <input
                id="invite"
                type="url"
                placeholder="Paste your invite link"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                disabled={starting || !initialized}
              />
            </div>
            <button
              className="secondary-button full"
              onClick={() => void connect(false)}
              disabled={starting || !initialized || !inviteInput}
            >
              Join a lobby <ArrowRight size={18} />
            </button>
            <p className="small muted connection-note">
              Online rooms use external discovery and STUN services; your game
              runs in the browsers. Local mode connects tabs on this browser
              only.
            </p>
            {error ? (
              <p className="error-box" role="alert">
                {error}
              </p>
            ) : null}
          </section>
        </div>
      ) : (
        <div className="session-layout">
          <div className="session-toolbar">
            <div>
              <div className="eyebrow">
                {invite?.network === "local"
                  ? "LOCAL BROWSER TABLE"
                  : "PRIVATE P2P TABLE"}
              </div>
              <div className="connection-status">
                <span
                  className={`status-dot ${view.status !== "connected" ? "amber" : ""}`}
                />
                {statusText(view.status)}{" "}
                {view.busy && view.status === "connected"
                  ? "· confirming move"
                  : ""}
              </div>
            </div>
            <div className="toolbar-buttons">
              <button
                className="secondary-button"
                onClick={() => void copyInvite()}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
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
          {view.status === "paused" || view.status === "electing" ? (
            <div className="notice" role="status">
              {view.status === "paused"
                ? "Waiting for a majority of players to reconnect. Keep this tab open; play resumes when the table can safely confirm moves."
                : "The game master disconnected. Choosing a replacement and recovering the table…"}
            </div>
          ) : null}
          {!state ? (
            <div className="loading-table">
              <LoaderCircle className="spin" size={30} />
              <h2>Finding your table…</h2>
              <p className="muted">
                The creator needs to keep their tab open. Discovery may take a
                moment.
              </p>
              <p className="small muted">
                If online peers cannot connect, your network may need a TURN
                relay. Local invites only work in this browser.
              </p>
            </div>
          ) : state.phase === "lobby" ? (
            <Lobby
              state={state}
              session={session}
              onCopy={() => void copyInvite()}
              copied={copied}
            />
          ) : self ? (
            <GameTable state={state} session={session} />
          ) : (
            <div className="notice">
              Waiting to be admitted. If the table is full or the match has
              begun, ask the creator for a new lobby.
            </div>
          )}
        </div>
      )}
      <footer className="site-footer">
        <span>A little luck. A lot of “one more.”</span>
        <span>Classic rules · Local state · Made for friends</span>
      </footer>
      {showRules ? <Rules onClose={() => setShowRules(false)} /> : null}
    </main>
  );
}
function statusText(status: string) {
  return (
    {
      connecting: "Connecting",
      waiting: "Waiting for admission",
      connected: "Connected",
      electing: "Recovering game master",
      paused: "Table paused",
      closed: "Disconnected",
    } as Record<string, string>
  )[status];
}

function Lobby({
  state,
  session,
  onCopy,
  copied,
}: {
  state: GameState;
  session: GameSession;
  onCopy: () => void;
  copied: boolean;
}) {
  const view = useSession();
  const self = state.players.find((p) => p.id === view.selfId);
  const owner = state.ownerId === view.selfId;
  const enabled = view.status === "connected" && !view.busy;
  const allReady =
    state.players.length >= 2 &&
    state.players.every((p) => p.ready && view.online.includes(p.id));
  return (
    <div className="lobby-grid">
      <section className="panel lobby-panel">
        <div className="section-heading">
          <div>
            <div className="eyebrow">THE WAITING ROOM</div>
            <h1>Your table is taking shape.</h1>
          </div>
          <span className="pill">
            <Users size={15} /> {state.players.length}/{state.maxPlayers}
          </span>
        </div>
        <p className="muted">Send the invite, settle in, and ready up.</p>
        <div className="player-grid">
          {state.players.map((player, index) => (
            <div className="player-tile" key={player.id}>
              <div className={`avatar avatar-${index % 4}`}>
                {player.name.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <strong>
                  {player.name}
                  {player.id === view.selfId ? " (you)" : ""}
                </strong>
                <span className="player-role">
                  {player.id === state.ownerId
                    ? "Lobby creator"
                    : player.id === view.leaderId
                      ? "Game master"
                      : "Player"}
                  {!view.online.includes(player.id) ? " · reconnecting" : ""}
                </span>
              </div>
              {player.ready ? (
                <span className="ready-badge">
                  <Check size={14} /> Ready
                </span>
              ) : (
                <span className="muted small">Not ready</span>
              )}
            </div>
          ))}
          {Array.from(
            { length: Math.max(0, state.maxPlayers - state.players.length) },
            (_, i) => (
              <div key={`empty-${i}`} className="empty-seat">
                <Plus size={20} />
                <span>Room for a friend</span>
              </div>
            ),
          )}
        </div>
        <div className="lobby-bottom">
          {self ? (
            <button
              className={self.ready ? "secondary-button" : "primary-button"}
              disabled={!enabled}
              onClick={() => session.act({ type: "READY", ready: !self.ready })}
            >
              <Check size={17} />
              {self.ready ? "Unready" : "I’m ready"}
            </button>
          ) : (
            <span className="muted">Joining the table…</span>
          )}
          {owner ? (
            <button
              className="primary-button"
              disabled={!enabled || !allReady}
              onClick={() =>
                session.act({
                  type: "START",
                  seed: crypto.getRandomValues(new Uint32Array(1))[0],
                })
              }
            >
              Start the game <ArrowRight size={18} />
            </button>
          ) : (
            <span className="small muted">
              The lobby owner starts when everyone is ready.
            </span>
          )}
        </div>
      </section>
      <aside className="lobby-sidebar">
        <section className="panel">
          <div className="eyebrow">THE MORE, THE MERRIER</div>
          <h2>Deal your friends in.</h2>
          <p className="muted">One private link. Everyone at the same table.</p>
          <button className="secondary-button full" onClick={onCopy}>
            <Copy size={16} />
            {copied ? "Link copied" : "Copy invite link"}
          </button>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h3>Table settings</h3>
            <Crown size={18} className="accent-text" />
          </div>
          <label className="field-label" htmlFor="lobby-capacity">
            Maximum players
          </label>
          <select
            id="lobby-capacity"
            value={state.maxPlayers}
            disabled={!owner || !enabled}
            onChange={(e) =>
              session.act({ type: "SET_CAPACITY", max: Number(e.target.value) })
            }
          >
            {Array.from({ length: 11 }, (_, i) => i + 2)
              .filter((n) => n >= state.players.length)
              .map((n) => (
                <option key={n} value={n}>
                  {n} players
                </option>
              ))}
          </select>
          <p className="small muted">
            {state.maxPlayers > 10
              ? "11–12 players extends official UNO capacity. All other rules remain classic."
              : "Classic 108-card deck. No stacking or jump-in. First to 500 points."}
          </p>
        </section>
        <div className="sidebar-note">
          <ShieldCheck size={22} />
          <p>
            Your browsers keep this game alive. Keep your tab open, including
            while waiting.
          </p>
        </div>
      </aside>
    </div>
  );
}

function GameTable({
  state,
  session,
}: {
  state: GameState;
  session: GameSession;
}) {
  const view = useSession();
  const [wildCard, setWildCard] = useState<Card | null>(null);
  const [declareUno, setDeclareUno] = useState(true);
  const [revealed, setRevealed] = useState<Card[] | null>(null);
  const hand = state.hands[view.selfId] ?? [];
  const turn = currentPlayer(state);
  const isTurn = turn.id === view.selfId;
  const enabled =
    state.phase === "playing" && view.status === "connected" && !view.busy;
  const challenge =
    state.challenge?.targetId === view.selfId ? state.challenge : null;
  const chooseOpening = state.pendingWild?.playerId === view.selfId;
  function play(card: Card, color?: Color) {
    if (card.color === null && !color) {
      setWildCard(card);
      return;
    }
    session.act({
      type: "PLAY",
      cardId: card.id,
      ...(color ? { color } : {}),
      uno: declareUno,
    });
    setWildCard(null);
  }
  const top = state.discard.at(-1)!;
  const winner = state.players.find((p) => p.id === state.winnerId);
  return (
    <div className="game-layout">
      <section className="table-section">
        <div className="table-heading">
          <div>
            <div className="eyebrow">ROUND {state.round}</div>
            <h2>
              {state.phase === "playing"
                ? isTurn
                  ? "Your move."
                  : `${turn.name}’s move.`
                : `${winner?.name} wins${state.phase === "match-over" ? " the match" : " the round"}!`}
            </h2>
          </div>
          <span className="pill">
            {state.direction === 1 ? "↻ Clockwise" : "↺ Counterclockwise"}
          </span>
        </div>
        <div className="felt-table">
          <div className="opponents">
            {state.players
              .filter((p) => p.id !== view.selfId)
              .map((p, index) => (
                <div
                  className={`opponent ${p.id === turn.id && state.phase === "playing" ? "active" : ""}`}
                  key={p.id}
                >
                  <div className={`avatar avatar-${index % 4}`}>
                    {p.name.slice(0, 1).toUpperCase()}
                  </div>
                  <strong>{p.name}</strong>
                  <span>
                    {state.hands[p.id].length} cards
                    {!view.online.includes(p.id) ? " · offline" : ""}
                  </span>
                  {state.unoVulnerable === p.id ? (
                    <button
                      className="catch-button"
                      disabled={!enabled}
                      onClick={() =>
                        session.act({ type: "CATCH_UNO", playerId: p.id })
                      }
                    >
                      Catch UNO!
                    </button>
                  ) : state.hands[p.id].length === 1 ? (
                    <span className="uno-tag">UNO</span>
                  ) : null}
                </div>
              ))}
          </div>
          <div className="table-center">
            <div className="deck-stack">
              <button
                className="draw-button"
                aria-label="Draw one card"
                disabled={
                  !enabled ||
                  !isTurn ||
                  state.hasDrawn ||
                  !!state.challenge ||
                  !!state.pendingWild
                }
                onClick={() => session.act({ type: "DRAW" })}
              >
                <CardBack />
              </button>
              <span className="pile-label">DRAW · {state.drawPile.length}</span>
            </div>
            <div className="discard-stack">
              <PlayingCard card={top} />
              <span className={`active-color-dot ${state.activeColor}`} />
              <span className="pile-label">
                {state.activeColor.toUpperCase()} IN PLAY
              </span>
            </div>
          </div>
          <div className="table-message" role="status" aria-live="polite">
            {state.message}
          </div>
        </div>
        <div className="hand-section">
          <div className="hand-heading">
            <h3>
              Your hand <span className="muted">· {hand.length} cards</span>
            </h3>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={declareUno}
                onChange={(e) => setDeclareUno(e.target.checked)}
              />{" "}
              Call UNO with my play
            </label>
          </div>
          <div className="hand">
            {hand.map((card) => {
              const playable =
                enabled &&
                isTurn &&
                !state.challenge &&
                !state.pendingWild &&
                canPlay(state, card) &&
                (!state.hasDrawn || card.id === state.drawnCardId);
              return (
                <PlayingCard
                  key={card.id}
                  card={card}
                  onClick={() => play(card)}
                  disabled={!playable}
                  highlighted={!!playable}
                />
              );
            })}
          </div>
          <div className="hand-actions">
            <span className="small muted">
              {!enabled
                ? "Waiting for the table."
                : isTurn
                  ? state.challenge
                    ? "Accept or challenge the Draw Four."
                    : state.pendingWild
                      ? "Waiting for a color choice."
                      : state.hasDrawn
                        ? "Play the drawn card or pass."
                        : "Play a highlighted card, or draw one."
                  : "Your cards stay with you. Watch for a missed UNO."}
            </span>
            {state.hasDrawn && isTurn ? (
              <button
                className="secondary-button"
                disabled={!enabled}
                onClick={() => session.act({ type: "PASS" })}
              >
                Pass turn <ArrowRight size={16} />
              </button>
            ) : null}
            {state.unoVulnerable === view.selfId ? (
              <button
                className="primary-button"
                disabled={!enabled}
                onClick={() => session.act({ type: "UNO" })}
              >
                UNO!
              </button>
            ) : null}
          </div>
        </div>
        {challenge ? (
          <section className="notice challenge-panel">
            <h3>Wild Draw Four. Your call.</h3>
            <p>
              Accept four cards, or challenge if you think they had the previous
              color. A failed challenge costs six.
            </p>
            <div className="button-row">
              <button
                className="secondary-button"
                disabled={!enabled}
                onClick={() =>
                  session.act({ type: "RESOLVE_CHALLENGE", challenge: false })
                }
              >
                <ArrowDownToLine size={16} /> Accept four
              </button>
              <button
                className="primary-button"
                disabled={!enabled}
                onClick={() => {
                  setRevealed(challenge.previousHand);
                  session.act({ type: "RESOLVE_CHALLENGE", challenge: true });
                }}
              >
                Challenge
              </button>
            </div>
          </section>
        ) : null}
        {revealed ? (
          <section className="panel reveal-panel">
            <div className="section-heading">
              <h3>The challenged hand</h3>
              <button className="text-button" onClick={() => setRevealed(null)}>
                Dismiss
              </button>
            </div>
            <p className="small muted">
              The offender’s hand before playing Draw Four, revealed to you as
              the challenger.
            </p>
            <div className="hand small-hand">
              {revealed.map((card) => (
                <PlayingCard key={card.id} card={card} small />
              ))}
            </div>
          </section>
        ) : null}
        {state.phase !== "playing" ? (
          <section className="panel results">
            <h2>
              {state.phase === "match-over"
                ? "A well-played victory."
                : "There’s always another round."}
            </h2>
            <p className="muted">{state.message}</p>
            {state.ownerId === view.selfId && state.phase === "round-over" ? (
              <button
                className="primary-button"
                disabled={view.status !== "connected" || view.busy}
                onClick={() =>
                  session.act({
                    type: "NEXT_ROUND",
                    seed: crypto.getRandomValues(new Uint32Array(1))[0],
                  })
                }
              >
                Deal the next round <ArrowRight size={17} />
              </button>
            ) : (
              <p className="small muted">
                {state.phase === "match-over"
                  ? "Create a new lobby to play another match."
                  : "Waiting for the lobby owner to deal."}
              </p>
            )}
          </section>
        ) : null}
      </section>
      <aside className="scoreboard panel">
        <div className="eyebrow">THE LONG GAME</div>
        <h2>Race to 500.</h2>
        {[...state.players]
          .sort((a, b) => b.score - a.score)
          .map((p, i) => (
            <div className="score-row" key={p.id}>
              <span className="muted">{i + 1}</span>
              <span>
                {p.name}
                {p.id === view.selfId ? " (you)" : ""}
                {p.id === view.leaderId ? (
                  <Crown size={13} aria-label="Game master" />
                ) : null}
              </span>
              <strong>{p.score}</strong>
            </div>
          ))}
        <p className="small muted">
          Game state is replicated to trusted players so a new game master can
          recover the table.
        </p>
      </aside>
      {wildCard || chooseOpening ? (
        <Dialog
          labelId="color-title"
          className="color-modal"
          onClose={chooseOpening ? undefined : () => setWildCard(null)}
        >
          <div className="section-heading">
            <h2 id="color-title">Pick your color.</h2>
            {!chooseOpening ? (
              <button
                className="icon-button"
                onClick={() => setWildCard(null)}
                aria-label="Cancel color choice"
              >
                <X size={20} />
              </button>
            ) : null}
          </div>
          <p className="muted">Set the color for the next player.</p>
          <ColorPicker
            onChoose={(color) => {
              if (chooseOpening) session.act({ type: "COLOR", color });
              else if (wildCard) play(wildCard, color);
            }}
          />
        </Dialog>
      ) : null}
    </div>
  );
}
