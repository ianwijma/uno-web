# UNO Web

A private, browser-owned UNO game built with Next.js, TypeScript, and Tailwind CSS. Create a lobby, copy an invite, and play with friends. There is no game backend, account service, or remote database. This is an unofficial implementation of the classic game.

## Run locally

Use Node.js 24 (minimum 22.12):

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. To try multiplayer without internet discovery, create a lobby, select **On this browser** in the lobby’s **Play together** setting, and paste its invite into another tab in the same browser profile. Each tab gets its own player identity. Reloading the same tab automatically restores its lobby or game, player identity, readiness, and hand. Explicitly choosing **Leave table** opts out of auto-return until you join again.

For different devices, use **Across devices** (the default) and share the invite from an HTTPS deployment. A `localhost` link points to the recipient's own device, so it is only useful for tabs on the same machine.

```sh
npm run build
npm run preview
```

`next build` exports to `out/`. Any HTTPS static host can serve those files; no running Next.js server, API routes, or server actions are needed. Opening `index.html` directly through `file://` is not supported.

## Implemented

- Create or join an invite-only lobby; creator-configurable capacity from 2–12 total players.
- Copyable versioned invite containing room ID, founding identity, signaling strategy, and a random shared secret, in the URL fragment.
- Readiness, host-controlled start, admission capacity checks, and locked membership during a match.
- Felt playing surface, wooden frame and player pieces, paper scorepad, fixed-size scrolling card rack, animated deals/plays/draws, and explicit turn handoffs with reduced-motion support.
- Twelve exclusive player colors; choose a piece before readying. All configuration lives in the lobby. Changing rules or the goal resets readiness.
- Configurable points goal (50–5,000) or round-wins goal (1–20); classic default is 500 points. Scores and round wins are tracked separately.
- Draw/pass, UNO declarations and catches, Draw Four challenges, and round scoring.
- Pure deterministic rules engine for the **classic 108-card edition**. Classic rules are the default; optional house rules are described below. Jump-in and seven-zero are not implemented.
- WebRTC room discovery through Trystero's Nostr strategy; a BroadcastChannel transport for local testing.
- Canonical JSON, Zod message validation, ECDSA identities and signed room-scoped packets, sequenced authoritative snapshots, and IndexedDB journals through Dexie.
- Majority acknowledgements before committing moves; persisted votes, freshness checks, and host recovery from the latest accepted snapshot.
- Unit/property tests, browser multiplayer tests, and GitHub Actions verification.

Official classic UNO capacity is **2–10 players**. Rooms with 11–12 seats explicitly extend that capacity; card rules and the deck remain unchanged. Rule reference: [Mattel classic UNO instructions](https://service.mattel.com/instruction_sheets/UNO%20Basic%20IS.pdf).

## Networking and invites

Online mode has **no game server**, but is not infrastructure-free. Trystero uses existing public Nostr relays for signaling and STUN for network discovery. Gameplay travels over WebRTC data channels. The room secret encrypts Trystero's signaling descriptions; ECDSA authenticates protocol messages against each player's public-key fingerprint.

The invite contains discovery and admission information. Browser-specific WebRTC offers, answers, and ICE candidates are created and exchanged when players connect; a reusable URL cannot contain all future connection details. Treat the link as a bearer invitation and share it only with your group. The fragment is not included in the HTTP request, although browser history and anyone receiving the link can see it.

Some NATs/firewalls need TURN. Default mode has no provisioned TURN service, so internet connectivity is best effort. A developer can configure their own short-lived ICE settings in the browser before joining:

```js
localStorage.setItem(
  "uno-ice-servers-v1",
  JSON.stringify([
    { urls: "stun:your-stun.example:3478" },
    {
      urls: "turns:your-turn.example:5349",
      username: "temporary-user",
      credential: "temporary-credential",
    },
  ]),
);
```

Custom ICE settings replace defaults. Do not embed permanent relay credentials in the source or invitation. Local mode requires no external discovery, STUN, or TURN, and only connects tabs in one browser profile on the same origin.

## Authority, replication, and recovery

The lobby creator is initially the game master. The dealer is selected independently by the rules engine. Clients send commands with a unique request ID and expected revision; the master validates a command, proposes the next full snapshot, and waits for a majority before committing it. Admission requires majorities of both the previous and proposed membership.

All admitted browsers keep recovery snapshots: hidden hands, exact draw-pile order, turn, pending challenges, UNO windows, scores, and deterministic shuffle state. Acknowledgements and election votes are persisted before transmission. A new leader re-proposes the freshest accepted snapshot in its new term, including a move acknowledged before the old leader failed to broadcast its commit. Duplicate IDs, stale revisions, old terms, and altered snapshot hashes are rejected. Lobby ownership transfers to the elected master so someone can deal the next round.

This is a **trusted-friends prototype**, not a formally verified Raft implementation or protection against malicious participants. Signed messages authenticate senders, but leadership certificates are claimed voter lists rather than independently verified signed vote proofs. A determined participant can inspect all hidden state from their recovery replica. Browser encryption with locally accessible keys would not prevent this.

A majority of admitted players must remain connected. A three-player table can recover with two survivors; a two-player table pauses if either leaves. There is no automatic shrinking of membership to evade quorum. A departed player keeps their hand; their turn waits for reconnection or the configured turn deadline. Closing a tab permanently loses its session identity; reconnect in the same tab, including after reload (which automatically reconnects). Private browsing/storage deletion can also prevent recovery. If every browser leaves, there is no always-on peer to serve an invitation; surviving saved sessions must reconnect and regain a majority.

Background tabs and suspended mobile browsers may delay heartbeats or appear disconnected. A 12-player WebRTC mesh has 66 peer connections; real-device and network testing at that size remains necessary.

Version 2 invites and rooms are intentionally separate from the earlier prototype. Create a new lobby and share its new link after updating.

## Connection feedback and decisions

Connection loss/recovery and game-master changes appear as brief, dismissible notifications (Sonner), rather than persistent banners. Required special decisions use accessible, focus-trapped dialogs (Radix): Wild color choices, Draw Four challenges, +2 stacking, playable drawn-card choices, and round results. Pending decisions cannot be dismissed without resolving them; turn timeouts still apply. Challenge evidence and results can be dismissed and results reopened from the scorepad.

A dot before each player’s name shows recently authenticated activity: green within 4.5 seconds, orange for delayed heartbeats, red after 12 seconds without traffic. These are reachability indicators, not latency measurements. Valid commands/acknowledgements addressed to another peer also refresh presence; unauthenticated traffic cannot. Unknown peers initially receive an orange discovery window. Quorum and election timing are unchanged.

## Rules and digital timing

The engine implements initial dealer selection, seven-card dealing, opening action-card effects, matching by color/number/symbol, voluntary drawing, only playing the newly drawn card after a draw, two-player action rules, draw penalties, discard recycling, and scoring. Wild Draw Four bluffs are allowed and resolved through a challenge, including when the last card is a Draw Four. The challenger sees the pre-play hand as evidence.

UNO is declared only by pressing **UNO!** after reaching one card. Playing a card never declares it automatically, and the UNO badge appears only after the explicit call. The button remains usable during card animations; it also works when catch penalties are disabled. A missed declaration is penalized only if another player catches it before the next turn action starts, including when a two-player action card gives the same player another turn. Playing the last card still ends the round under classic rules; no extra declaration is required at zero cards. Commands are ordered by the master; animation timing does not decide legality. Multi-card penalties are resolved atomically, and only real available cards can be drawn when the entire deck is held in players' hands.

### Turn timer and reconnecting

New lobbies default to **30 seconds per turn**. In the lobby, the host can select 15, 30, 60, 90, or 120 seconds, or **Unlimited**; changing the timer resets readiness. A visible countdown uses the deadline stored in the replicated snapshot. Drawing, UNO calls, choosing a wild color, reloading, and host elections do not restart it. A new turn starts a new deadline, including a two-player skip/reverse that gives the same player another go.

At expiry, the game master commits a skipped turn. No extra card is drawn for a normal timeout. Pending +2 stacks are taken, and a pending Wild Draw Four is accepted before passing; an unanswered opening Wild keeps the displayed red fallback. This also ends a turn after drawing even when the “Play what you draw” house rule is enabled. These are optional digital timing rules, separate from classic UNO. Unlimited turns are never skipped because a player disconnects.

The timer continues through reloads and connection outages. A majority is still required to commit an expired turn; after reconnection or an election, the current expired turn resolves once, without retroactively skipping later turns. Suspended host browsers can delay expiry processing, and countdown displays assume reasonably synchronized device clocks. Existing saved version-2 games without timer fields remain unlimited. All peers should run the updated app.

Saved sessions reconnect automatically in the same browser tab and origin. New invite recipients still enter their name and join. Restoration waits for the current host or election before enabling play; it neither deals new cards nor advances the turn. Reloading retains session identity; closing a tab permanently or clearing browser storage still has the recovery limitations described above.

### Optional house rules

The creator can configure these before dealing; they remain fixed during a match:

- **Stack Draw Two:** answer a pending +2 with another +2 of any color, or take the accumulated penalty and lose the turn. +4 never stacks. Going out resolves the pending penalty before scoring.
- **Draw until playable:** draw until a playable card appears or the available deck is exhausted. Only the final drawn card may be played.
- **Must play drawn card:** a playable draw must be played; passing is disabled. Wild cards still require choosing a color.
- **UNO catch penalty:** enabled by default; disable to remove missed-UNO catches and their two-card penalty.

Card movement finishes before the next turn announcement and controls become active. A growing hand scrolls horizontally without shrinking the cards or resizing the board. Reduced-motion preferences remove flying cards and keep a brief turn announcement.

## Verify

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

The default browser tests use the local transport: admission, full-lobby rejection, readiness, dealing, master departure, election, matching recovered hands/deck, same-seat reconnection, reload recovery, and a replicated draw. They also exercise exclusive colors, lobby configuration, readiness resets, animated draws, and stable card/table dimensions. Mobile checks cover validation, rules, overflow, reduced motion, and a 20-card hand with unchanged card/table dimensions. Browser stories also cover manual UNO/catches, mobile decision dialogs and focus, +2 stacking, drawn-wild color selection, transient notifications, and recovery of stale presence from targeted signed commands. Unit/property tests cover rule edge cases, presence thresholds, and card conservation across randomized 2–12-player games.

An optional public-relay smoke test is available:

```sh
UNO_TEST_ONLINE=1 npx playwright test tests/browser/online.spec.ts
```

Public-relay availability and NAT traversal are outside the deterministic test suite. The optional test uses the inherited HTTPS proxy when configured. Passing browser-tab tests does not establish reliable WebRTC connectivity across arbitrary internet networks.

Set `UNO_TEST_STATIC=1` after `npm run build` to run browser tests against the exported production files instead of the development server. CI uses this mode.

## Structure

```text
src/lib/game/        # Typed state, classic rules, deterministic reducer
src/lib/network/     # Invites, signed protocol, transports, journal, election
src/components/      # Lobby, table, cards, accessible dialogs
src/app/             # Static Next.js entry point, Tailwind and styles
tests/               # Rule/property tests and browser stories
```

Next steps are public-network/mobile testing, stronger election proof verification and fault-injection tests, lobby removal with safe membership changes, and an explicit product policy for permanent player departure. No bot takeover, public lobby listing, matchmaking, or cloud persistence is implemented.
