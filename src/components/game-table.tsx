"use client";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check, Crown, X } from "lucide-react";
import { canPlay, currentPlayer } from "@/lib/game/engine";
import { Card, Color, GameState } from "@/lib/game/types";
import { colorHex, goalLabel, isClassic } from "@/lib/game/settings";
import { GameSession } from "@/lib/network/session";
import { useSession } from "@/lib/network/store";
import { CardBack, ColorPicker, PlayingCard } from "./card";
import { Dialog } from "./dialog";
import { PlayerToken } from "./player-token";
import {
  TableFlights,
  TurnAnnouncement,
  useTablePresentation,
} from "./table-animation";

export function GameTable({
  state: liveState,
  session,
}: {
  state: GameState;
  session: GameSession;
}) {
  const view = useSession();
  const {
    shown: state,
    moving,
    announcement,
    animating,
    reduced,
  } = useTablePresentation(liveState);
  const [wildCard, setWildCard] = useState<Card | null>(null);
  const [declareUno, setDeclareUno] = useState(true);
  const [revealed, setRevealed] = useState<Card[] | null>(null);
  const rack = useRef<HTMLDivElement>(null);
  const hand = state.hands[view.selfId] ?? [];
  const self = state.players.find((p) => p.id === view.selfId)!;
  const turn = currentPlayer(state);
  const isTurn = turn.id === view.selfId;
  const enabled =
    state.phase === "playing" &&
    view.status === "connected" &&
    !view.busy &&
    !animating &&
    state.animation.id === liveState.animation.id;
  const challenge =
    state.challenge?.targetId === view.selfId ? state.challenge : null;
  const chooseOpening = state.pendingWild?.playerId === view.selfId;
  const opponents = state.players.filter((p) => p.id !== view.selfId);
  const movingCard = moving?.events.find((e) => e.kind === "play")?.card?.id;
  const top = state.discard.at(-1)!;
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
  const winner = state.players.find((p) => p.id === state.winnerId);
  const sortedPlayers = [...state.players].sort((a, b) =>
    state.goal.mode === "points"
      ? b.score - a.score
      : b.wins - a.wins || b.score - a.score,
  );
  const instruction = animating
    ? "Following the play…"
    : !enabled
      ? view.status === "connected"
        ? "Confirming the move…"
        : "Waiting for the table to reconnect."
      : !isTurn
        ? `${turn.name} is thinking. Watch the table.`
        : state.pendingWild
          ? "Choose the opening color."
          : challenge
            ? "Accept four cards or challenge the play."
            : state.pendingDrawTwo
              ? `Stack a +2 or draw ${state.pendingDrawTwo}.`
              : state.hasDrawn
                ? state.rules.mustPlayDrawn
                  ? "Play the card you just drew."
                  : "Play the new card or end your turn."
                : "Match a color, number, or symbol — or draw.";
  return (
    <div
      className="game-layout"
      data-testid="game-table"
      data-animating={animating}
    >
      <section className="table-section">
        <div className="game-heading">
          <div>
            <span className="table-stamp">
              ROUND {state.round} ·{" "}
              {isClassic(state.rules) ? "CLASSIC RULES" : "HOUSE RULES"}
            </span>
            <h1 aria-live="polite">
              {state.phase !== "playing"
                ? `${winner?.name} wins${state.phase === "match-over" ? " the match" : " the round"}!`
                : isTurn
                  ? "Your turn."
                  : `${turn.name}’s turn.`}
            </h1>
          </div>
          <span
            className="direction-indicator"
            aria-label={
              state.direction === 1 ? "Clockwise" : "Counterclockwise"
            }
          >
            <motion.span
              animate={{ rotate: state.direction === 1 ? 0 : -180 }}
              transition={{ duration: reduced ? 0 : 0.4 }}
            >
              ↻
            </motion.span>
            {state.direction === 1 ? "Clockwise" : "Counterclockwise"}
          </span>
        </div>
        <div className="wood-frame game-board">
          <div
            className={`felt-table ${opponents.length > 4 ? "large-table" : ""}`}
          >
            <div className="opponent-rail">
              {opponents.map((player) => (
                <article
                  key={player.id}
                  data-seat={player.id}
                  className={`opponent-seat ${player.id === turn.id && state.phase === "playing" ? "current" : ""}`}
                  style={{ "--token": colorHex(player.color) } as CSSProperties}
                >
                  <div className="opponent-piece">
                    <PlayerToken player={player} />
                    {player.id === turn.id && state.phase === "playing" ? (
                      <span
                        className="turn-pointer"
                        key={state.turnSerial}
                        aria-label="Current player"
                      >
                        ▼
                      </span>
                    ) : null}
                  </div>
                  <strong>{player.name}</strong>
                  <span className="card-count">
                    {state.hands[player.id].length} cards
                    {!view.online.includes(player.id) ? " · offline" : ""}
                  </span>
                  <div className="mini-hand" aria-hidden="true">
                    {Array.from(
                      { length: Math.min(5, state.hands[player.id].length) },
                      (_, i) => (
                        <i key={i} style={{ rotate: `${(i - 2) * 6}deg` }} />
                      ),
                    )}
                  </div>
                  {state.unoVulnerable === player.id ? (
                    <button
                      className="catch-button"
                      disabled={!enabled}
                      onClick={() =>
                        session.act({ type: "CATCH_UNO", playerId: player.id })
                      }
                    >
                      Catch UNO!
                    </button>
                  ) : state.hands[player.id].length === 1 ? (
                    <span className="uno-tag">UNO</span>
                  ) : null}
                </article>
              ))}
            </div>
            <div className="table-watermark" aria-hidden="true">
              UNO<span>THE FRIENDS’ TABLE</span>
            </div>
            <div className="table-center">
              <div className="pile" data-pile="draw">
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
                <span className="pile-label">
                  DRAW PILE <b>{state.drawPile.length}</b>
                </span>
              </div>
              <div className="pile discard-pile">
                <div data-pile="discard" className="discard-top">
                  <PlayingCard card={top} />
                </div>
                <span className={`color-chip ${state.activeColor}`}>
                  {state.activeColor}
                </span>
              </div>
            </div>
            <div
              className="turn-track"
              style={{ "--token": colorHex(turn.color) } as CSSProperties}
            >
              <span className="turn-track-dot" key={state.turnSerial} />
              <span>
                {state.phase === "playing"
                  ? `${turn.name} to play`
                  : "Round complete"}
              </span>
              {state.pendingDrawTwo ? (
                <strong>+{state.pendingDrawTwo} waiting</strong>
              ) : null}
            </div>
            <TurnAnnouncement
              announcement={announcement}
              selfId={view.selfId}
              reduced={reduced}
            />
          </div>
        </div>
        <div className="move-caption" role="status" aria-live="polite">
          {state.message}
        </div>
        <section className="hand-rack" aria-label="Your hand">
          <div className="rack-header">
            <div className="your-piece" data-seat={self.id}>
              <PlayerToken player={self} small />
              <h2>
                Your hand <span>{hand.length} cards</span>
              </h2>
            </div>
            <div className="rack-scroll">
              <button
                className="icon-button"
                aria-label="Scroll hand left"
                onClick={() =>
                  rack.current?.scrollBy({
                    left: -280,
                    behavior: reduced ? "instant" : "smooth",
                  })
                }
              >
                <ArrowLeft size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Scroll hand right"
                onClick={() =>
                  rack.current?.scrollBy({
                    left: 280,
                    behavior: reduced ? "instant" : "smooth",
                  })
                }
              >
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
          <div
            className="hand-scroll"
            ref={rack}
            tabIndex={0}
            aria-label="Scroll your cards"
          >
            <div className="hand-cards">
              {hand.map((card) => {
                const playable =
                  enabled &&
                  isTurn &&
                  !state.challenge &&
                  !state.pendingWild &&
                  canPlay(state, card) &&
                  (!state.hasDrawn || card.id === state.drawnCardId);
                return (
                  <motion.div
                    className={`hand-card ${movingCard === card.id ? "in-flight" : ""}`}
                    key={card.id}
                    data-card-id={card.id}
                    layout={reduced ? false : "position"}
                    initial={{ opacity: 0, y: reduced ? 0 : 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduced ? 0 : 0.2 }}
                  >
                    <PlayingCard
                      card={card}
                      onClick={() => play(card)}
                      disabled={!playable}
                      highlighted={!!playable}
                    />
                  </motion.div>
                );
              })}
            </div>
          </div>
          <div className="rack-lip" aria-hidden="true" />
          <div className="hand-controls">
            <p>{instruction}</p>
            <div className="hand-buttons">
              <button
                className="cream-button"
                disabled={
                  !enabled ||
                  !isTurn ||
                  state.hasDrawn ||
                  !!state.challenge ||
                  !!state.pendingWild
                }
                onClick={() => session.act({ type: "DRAW" })}
              >
                {state.pendingDrawTwo
                  ? `Take ${state.pendingDrawTwo} cards`
                  : state.rules.drawUntilPlayable
                    ? "Draw until playable"
                    : "Draw a card"}
              </button>
              <button
                className="cream-button"
                disabled={
                  !enabled ||
                  !isTurn ||
                  !state.hasDrawn ||
                  state.rules.mustPlayDrawn
                }
                onClick={() => session.act({ type: "PASS" })}
              >
                End turn <Check size={15} />
              </button>
              <button
                className="red-button uno-button"
                disabled={!enabled || state.unoVulnerable !== self.id}
                onClick={() => session.act({ type: "UNO" })}
              >
                UNO!
              </button>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={declareUno}
                onChange={(e) => setDeclareUno(e.target.checked)}
              />{" "}
              Call UNO with my play
            </label>
          </div>
        </section>
        {challenge ? (
          <section className="paper challenge-slip">
            <h2>A Wild Draw Four. Your call.</h2>
            <p>
              Challenge if they had the previous color. Lose the challenge and
              you draw six.
            </p>
            <div className="button-row">
              <button
                className="cream-button"
                disabled={!enabled}
                onClick={() =>
                  session.act({ type: "RESOLVE_CHALLENGE", challenge: false })
                }
              >
                Accept four
              </button>
              <button
                className="red-button"
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
          <section className="paper reveal-slip">
            <div className="paper-heading">
              <h2>The challenged hand</h2>
              <button
                className="icon-button"
                aria-label="Dismiss challenged hand"
                onClick={() => setRevealed(null)}
              >
                <X size={20} />
              </button>
            </div>
            <p>Revealed to you as the challenger.</p>
            <div className="revealed-cards">
              {revealed.map((card) => (
                <PlayingCard key={card.id} card={card} small />
              ))}
            </div>
          </section>
        ) : null}
        {state.phase !== "playing" ? (
          <section className="paper results">
            <span className="eyebrow">
              {state.phase === "match-over"
                ? "WE HAVE A WINNER"
                : "PENCILS OUT"}
            </span>
            <h2>
              {state.phase === "match-over"
                ? `${winner?.name} takes the game.`
                : "Mark it on the scorepad."}
            </h2>
            <p>
              {state.message} {goalLabel(state.goal)}.
            </p>
            {state.ownerId === self.id && state.phase === "round-over" ? (
              <button
                className="red-button"
                disabled={view.status !== "connected" || view.busy || animating}
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
              <p className="field-hint">
                {state.phase === "match-over"
                  ? "Create a new lobby to play another match."
                  : "The host will deal the next round."}
              </p>
            )}
          </section>
        ) : null}
      </section>
      <aside className="paper scorepad">
        <div className="scorepad-clip" aria-hidden="true" />
        <span className="eyebrow">KEEPING SCORE</span>
        <h2>{goalLabel(state.goal)}.</h2>
        <div className="scorepad-columns">
          <span>Player</span>
          <span>{state.goal.mode === "points" ? "Points" : "Wins"}</span>
        </div>
        {sortedPlayers.map((player) => (
          <div className="score-row" key={player.id}>
            <PlayerToken player={player} small />
            <span>
              {player.name}
              {player.id === self.id ? " (you)" : ""}
              {player.id === view.leaderId ? (
                <Crown size={12} aria-label="Game master" />
              ) : null}
              <small>
                {state.goal.mode === "points"
                  ? `${player.wins} round wins`
                  : `${player.score} points`}
              </small>
            </span>
            <strong>
              {state.goal.mode === "points" ? player.score : player.wins}
            </strong>
          </div>
        ))}
        <div className="scorepad-foot">
          <span className="ink-stamp">
            {isClassic(state.rules) ? "CLASSIC" : "HOUSE RULES"}
          </span>
          <p>
            {state.rules.stackDrawTwo ? "+2 stacking. " : "No stacking. "}
            {state.rules.drawUntilPlayable
              ? "Draw until playable. "
              : "Draw one. "}
            {state.rules.mustPlayDrawn
              ? "Must play the drawn card. "
              : "May keep the drawn card. "}
            {state.rules.unoPenalty
              ? "Catch missed UNO calls."
              : "No UNO penalty."}
          </p>
        </div>
      </aside>
      {moving ? <TableFlights key={moving.id} events={moving.events} /> : null}
      {wildCard || (chooseOpening && !animating) ? (
        <Dialog
          labelId="color-title"
          className="paper color-modal"
          onClose={chooseOpening ? undefined : () => setWildCard(null)}
        >
          <div className="paper-heading">
            <h2 id="color-title">Pick the next color.</h2>
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
          <ColorPicker
            onChoose={(color) => {
              if (!enabled) return;
              if (chooseOpening) session.act({ type: "COLOR", color });
              else if (wildCard) play(wildCard, color);
            }}
          />
        </Dialog>
      ) : null}
    </div>
  );
}
