import { createLobby, reduceGame } from "../game/engine";
import { GameAction, Player, TimeoutAction } from "../game/types";
import { Invite } from "./invite";
import {
  canonical,
  Envelope,
  envelopeSchema,
  Frame,
  isLogCurrent,
  jointMajority,
  makeFrame,
  Message,
  validFrame,
} from "./protocol";
import { db, decode, encode, Identity, Journal } from "./storage";
import { useSession } from "./store";
import { createTransport, Transport } from "./transport";

type Proposal = {
  frame: Frame;
  before: string[];
  after: string[];
  requestId: string;
  actorId: string;
  votes: Set<string>;
};
const members = (frame: Frame | null) =>
  frame?.state.players.map((p) => p.id) ?? [];
const heartbeatInterval = 1500;
const timeout = 6500;

/** Trusted-player replication. This is deliberately not a Byzantine consensus protocol. */
export class GameSession {
  restoredGame = false;
  private transport: Transport | null = null;
  private privateKey!: CryptoKey;
  private publicKeys = new Map<string, CryptoKey>();
  private journal: Journal;
  private leaderId: string | null;
  private seen = new Map<string, number>();
  private lastLeaderSeen = Date.now();
  private electionAt = Date.now() + timeout + Math.random() * 2000;
  private votes = new Set<string>();
  private candidate = false;
  private readyLeader = false;
  private changingNetwork = false;
  private pending: Proposal | null = null;
  private processed = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private outstandingUntil = 0;
  private lastAnnounced = 0;

  constructor(
    readonly invite: Invite,
    readonly identity: Identity,
    readonly name: string,
  ) {
    this.journal = {
      key: `${identity.key}:${invite.room}`,
      term: 1,
      votedFor: null,
      leaderId: invite.founder,
      committed: null,
      accepted: null,
      before: [],
      after: [],
    };
    this.leaderId = invite.founder;
  }
  get selfId() {
    return this.identity.id;
  }
  private queue(task: () => Promise<void>) {
    this.tail = this.tail
      .then(async () => {
        if (!this.closed) await task();
      })
      .catch((error) => {
        if (!this.closed)
          this.error(
            error instanceof Error ? error.message : "Connection failed.",
          );
      });
  }
  private error(message: string) {
    useSession.setState({ error: message.slice(0, 300), busy: false });
  }
  clearError() {
    useSession.setState({ error: null });
  }
  private async persist() {
    await db.journals.put(this.journal);
  }
  private onlineIds() {
    const now = Date.now();
    return [
      this.selfId,
      ...Array.from(this.seen)
        .filter(([, time]) => now - time < timeout)
        .map(([id]) => id),
    ];
  }
  private electionConfig() {
    return this.journal.accepted &&
      this.journal.accepted.index > (this.journal.committed?.index ?? -1)
      ? { before: this.journal.before, after: this.journal.after }
      : {
          before: members(this.journal.committed),
          after: members(this.journal.committed),
        };
  }
  private publish() {
    const online = this.onlineIds();
    const config = this.electionConfig();
    const majority = jointMajority(online, config.before, config.after);
    const admitted = members(this.journal.committed).includes(this.selfId);
    const leaderAlive =
      this.leaderId === this.selfId ||
      Date.now() - this.lastLeaderSeen < timeout;
    const status = !this.journal.committed
      ? "connecting"
      : !admitted
        ? "waiting"
        : !majority
          ? "paused"
          : !leaderAlive || this.candidate
            ? "electing"
            : "connected";
    useSession.setState({
      state: this.journal.committed?.state ?? null,
      selfId: this.selfId,
      leaderId: this.leaderId,
      online,
      status,
      revision: this.journal.committed?.index ?? 0,
      busy:
        this.changingNetwork ||
        !!this.pending ||
        Date.now() < this.outstandingUntil ||
        (!this.readyLeader && this.leaderId === this.selfId),
    });
  }
  async open(initialCapacity?: number) {
    useSession.setState({
      state: null,
      selfId: this.selfId,
      leaderId: this.leaderId,
      status: "connecting",
      online: [this.selfId],
      revision: 0,
      busy: false,
      error: null,
    });
    this.privateKey = await crypto.subtle.importKey(
      "jwk",
      this.identity.privateKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const saved = await db.journals.get(this.journal.key);
    if (saved) {
      this.restoredGame =
        !!saved.committed && saved.committed.state.phase !== "lobby";
      this.journal = saved;
      // A reload must regain authority by election, never assume an old leader lease.
      this.leaderId = saved.leaderId === this.selfId ? null : saved.leaderId;
      this.lastLeaderSeen = 0;
    } else if (this.selfId === this.invite.founder && initialCapacity) {
      const player: Player = {
        id: this.selfId,
        name: this.name,
        score: 0,
        wins: 0,
        color: null,
        ready: false,
      };
      const frame = await makeFrame(createLobby(player, initialCapacity), 0, 1);
      this.journal.committed = frame;
      this.journal.accepted = frame;
      this.journal.before = this.journal.after = [this.selfId];
      this.journal.votedFor = this.selfId;
      this.readyLeader = true;
      await this.persist();
    }
    if (this.closed) return;
    this.transport = await createTransport(
      this.invite.room,
      this.invite.key,
      this.invite.network,
      (data) => this.queue(() => this.receive(data)),
      (message) => this.error(message),
    );
    if (this.closed) {
      this.transport.close();
      this.transport = null;
      return;
    }
    this.publish();
    await this.send({ type: "HELLO", name: this.name });
    this.timer = setInterval(
      () => this.queue(() => this.tick()),
      heartbeatInterval,
    );
  }
  async changeNetwork(network: Invite["network"]) {
    if (network === this.invite.network) return;
    const state = this.journal.committed?.state;
    if (
      !state ||
      state.phase !== "lobby" ||
      state.ownerId !== this.selfId ||
      state.players.length !== 1 ||
      this.pending ||
      this.changingNetwork
    )
      throw new Error("Choose the connection before inviting other players.");
    this.changingNetwork = true;
    this.publish();
    try {
      const transport = await createTransport(
        this.invite.room,
        this.invite.key,
        network,
        (data) => this.queue(() => this.receive(data)),
        (message) => this.error(message),
      );
      this.transport?.close();
      this.transport = transport;
      this.invite.network = network;
      await this.send({ type: "HELLO", name: this.name });
    } finally {
      this.changingNetwork = false;
      this.publish();
    }
  }
  private async send(message: Message, to?: string) {
    if (!this.transport || this.closed) return;
    const payload = {
      room: this.invite.room,
      from: this.selfId,
      ...(to ? { to } : {}),
      publicKey: this.identity.publicKey,
      message,
    };
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      this.privateKey,
      new TextEncoder().encode(canonical(payload)),
    );
    await this.transport.send({ ...payload, signature: encode(signature) });
  }
  private async multicast(message: Message, ids: string[]) {
    await Promise.all(
      [...new Set(ids)]
        .filter((id) => id !== this.selfId)
        .map((id) => this.send(message, id)),
    );
  }
  private async authenticate(envelope: Envelope): Promise<boolean> {
    const { signature, ...payload } = envelope;
    let key = this.publicKeys.get(envelope.from);
    if (!key) {
      const raw = decode(envelope.publicKey);
      const hash = await crypto.subtle.digest("SHA-256", raw);
      const id = Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      if (id !== envelope.from) return false;
      key = await crypto.subtle.importKey(
        "raw",
        raw,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      if (this.publicKeys.size > 64) this.publicKeys.clear();
      this.publicKeys.set(envelope.from, key);
    }
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      decode(signature),
      new TextEncoder().encode(canonical(payload)),
    );
  }
  private async receive(raw: unknown) {
    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) return;
    const envelope = parsed.data;
    if (
      envelope.room !== this.invite.room ||
      envelope.from === this.selfId ||
      (envelope.to && envelope.to !== this.selfId)
    )
      return;
    try {
      if (!(await this.authenticate(envelope))) return;
    } catch {
      return;
    }
    const from = envelope.from;
    this.seen.set(from, Date.now());
    const m = envelope.message;
    if (m.type === "HELLO") {
      if (
        this.leaderId === this.selfId &&
        this.readyLeader &&
        !this.changingNetwork &&
        this.journal.committed
      ) {
        const state = this.journal.committed.state;
        if (
          members(this.journal.committed).includes(from) ||
          state.phase === "lobby"
        ) {
          await this.send(
            {
              type: "STATE",
              frame: this.journal.committed,
              term: this.journal.term,
            },
            from,
          );
        }
        if (!members(this.journal.committed).includes(from)) {
          if (state.phase !== "lobby")
            await this.send(
              {
                type: "ERROR",
                message:
                  "This match has started. Only existing players can reconnect.",
              },
              from,
            );
          else if (!this.pending)
            await this.command(
              from,
              crypto.randomUUID(),
              this.journal.committed.index,
              {
                type: "JOIN",
                player: {
                  id: from,
                  name: m.name,
                  ready: false,
                  score: 0,
                  wins: 0,
                  color: null,
                },
              },
            );
        }
      }
    } else if (m.type === "STATE") {
      if (!(await validFrame(m.frame)) || !members(m.frame).includes(from))
        return;
      if (this.journal.committed && from !== this.leaderId) return;
      if (m.term < this.journal.term) return;
      // Existing replicas never replace newer accepted entries with old heartbeats.
      if (
        !this.journal.committed ||
        m.frame.index >= this.journal.committed.index
      ) {
        this.leaderId = from;
        this.journal.leaderId = from;
        this.lastLeaderSeen = Date.now();
        if (m.term > this.journal.term) this.journal.votedFor = null;
        this.journal.term = m.term;
        this.journal.committed = m.frame;
        if (
          !this.journal.accepted ||
          m.frame.index >= this.journal.accepted.index
        ) {
          this.journal.accepted = m.frame;
          this.journal.before = this.journal.after = members(m.frame);
        }
        this.outstandingUntil = 0;
        await this.persist();
      }
    } else if (m.type === "COMMAND") {
      if (this.leaderId === this.selfId && this.readyLeader)
        await this.command(from, m.id, m.revision, m.action);
    } else if (m.type === "PROPOSE") {
      if (
        from !== this.leaderId ||
        m.term !== this.journal.term ||
        !(await validFrame(m.frame))
      )
        return;
      if (
        m.frame.term !== m.term ||
        m.frame.index <= (this.journal.committed?.index ?? -1)
      )
        return;
      if (m.after.join() !== members(m.frame).join()) return;
      const local = this.journal.accepted;
      if (local && !isLogCurrent(m.frame, local)) return;
      this.journal.accepted = m.frame;
      this.journal.before = m.before;
      this.journal.after = m.after;
      // Persist before acknowledging: a reload must not forget an accepted move.
      await this.persist();
      await this.send({ type: "ACK", hash: m.frame.hash, term: m.term }, from);
    } else if (m.type === "ACK") {
      if (
        this.pending &&
        this.leaderId === this.selfId &&
        m.term === this.journal.term &&
        m.hash === this.pending.frame.hash
      ) {
        this.pending.votes.add(from);
        await this.tryCommit();
      }
    } else if (m.type === "COMMIT") {
      if (from !== this.leaderId || m.term !== this.journal.term) return;
      if (this.journal.accepted?.hash === m.hash) {
        this.journal.committed = this.journal.accepted;
        this.journal.before = this.journal.after = members(
          this.journal.committed,
        );
        this.outstandingUntil = 0;
        await this.persist();
      } else await this.send({ type: "REQUEST_STATE" }, from);
    } else if (m.type === "HEARTBEAT") {
      if (from !== this.leaderId || m.term !== this.journal.term) return;
      this.lastLeaderSeen = Date.now();
      this.candidate = false;
      if (this.journal.committed?.hash !== m.hash)
        await this.send({ type: "REQUEST_STATE" }, from);
    } else if (m.type === "REQUEST_STATE") {
      if (
        this.leaderId === this.selfId &&
        this.journal.committed &&
        members(this.journal.committed).includes(from)
      ) {
        await this.send(
          {
            type: "STATE",
            frame: this.journal.committed,
            term: this.journal.term,
          },
          from,
        );
      }
    } else if (m.type === "VOTE_REQUEST") {
      const config = this.electionConfig();
      if (
        ![...config.before, ...config.after].includes(from) ||
        ![...config.before, ...config.after].includes(this.selfId)
      )
        return;
      if (m.term < this.journal.term) return;
      if (m.term > this.journal.term) await this.changeTerm(m.term);
      const local = this.journal.accepted ?? this.journal.committed;
      if (
        (!this.journal.votedFor || this.journal.votedFor === from) &&
        local &&
        isLogCurrent({ term: m.lastTerm, index: m.lastIndex }, local)
      ) {
        this.journal.votedFor = from;
        this.electionAt = Date.now() + timeout + Math.random() * 2000;
        await this.persist();
        await this.send({ type: "VOTE", term: m.term }, from);
      }
    } else if (m.type === "VOTE") {
      if (this.candidate && m.term === this.journal.term) {
        this.votes.add(from);
        await this.tryLead();
      }
    } else if (m.type === "LEADER") {
      const config = this.electionConfig();
      if (
        !this.journal.committed ||
        m.term < this.journal.term ||
        ![...config.before, ...config.after].includes(from) ||
        !jointMajority(m.voters, config.before, config.after)
      )
        return;
      if (m.term > this.journal.term) await this.changeTerm(m.term);
      this.leaderId = from;
      this.journal.leaderId = from;
      this.candidate = false;
      this.lastLeaderSeen = Date.now();
      this.pending = null;
      await this.persist();
      await this.send({ type: "REQUEST_STATE" }, from);
    } else if (m.type === "ERROR") {
      if (from === this.leaderId) {
        this.outstandingUntil = 0;
        this.error(m.message);
      }
    }
    this.publish();
  }
  private async changeTerm(term: number) {
    this.journal.term = term;
    this.journal.votedFor = null;
    this.journal.leaderId = null;
    this.leaderId = null;
    this.candidate = false;
    this.readyLeader = false;
    this.pending = null;
    await this.persist();
  }
  private async expireTurn() {
    const frame = this.journal.committed;
    const state = frame?.state;
    if (
      !frame ||
      !state ||
      !this.readyLeader ||
      this.leaderId !== this.selfId ||
      this.pending ||
      state.phase !== "playing" ||
      !state.turnTimeoutSeconds ||
      state.turnDeadline == null ||
      Date.now() < state.turnDeadline
    )
      return;
    const config = this.electionConfig();
    if (!jointMajority(this.onlineIds(), config.before, config.after)) return;
    await this.command(
      this.selfId,
      `timeout-${state.turnSerial}-${state.turnDeadline}`,
      frame.index,
      {
        type: "TIMEOUT",
        turnSerial: state.turnSerial,
        deadline: state.turnDeadline,
      },
    );
  }
  private async tick() {
    await this.send({ type: "HELLO", name: this.name });
    if (this.leaderId === this.selfId) {
      if (this.journal.committed)
        await this.multicast(
          {
            type: "HEARTBEAT",
            term: this.journal.term,
            index: this.journal.committed.index,
            hash: this.journal.committed.hash,
          },
          members(this.journal.committed),
        );
      if (this.pending) {
        const p = this.pending;
        await this.multicast(
          {
            type: "PROPOSE",
            frame: p.frame,
            before: p.before,
            after: p.after,
            term: this.journal.term,
            requestId: p.requestId,
          },
          [...p.before, ...p.after],
        );
        await this.tryCommit();
      }
      await this.expireTurn();
      if (Date.now() - this.lastAnnounced > timeout) {
        this.lastAnnounced = Date.now();
        // Helps recovering replicas recognize leadership before requesting a checkpoint.
        if (this.votes.size)
          await this.multicast(
            {
              type: "LEADER",
              term: this.journal.term,
              voters: [...this.votes],
            },
            members(this.journal.committed),
          );
      }
    } else if (
      members(this.journal.committed).includes(this.selfId) &&
      Date.now() - this.lastLeaderSeen > timeout &&
      Date.now() > this.electionAt
    ) {
      const local = this.journal.accepted ?? this.journal.committed!;
      await this.changeTerm(this.journal.term + 1);
      this.journal.votedFor = this.selfId;
      this.candidate = true;
      this.votes = new Set([this.selfId]);
      this.electionAt = Date.now() + timeout + Math.random() * 3000;
      await this.persist();
      const config = this.electionConfig();
      await this.multicast(
        {
          type: "VOTE_REQUEST",
          term: this.journal.term,
          lastTerm: local.term,
          lastIndex: local.index,
        },
        [...config.before, ...config.after],
      );
      await this.tryLead();
    }
    this.publish();
  }
  private async tryLead() {
    const config = this.electionConfig();
    if (
      !this.candidate ||
      !jointMajority(this.votes, config.before, config.after)
    )
      return;
    this.candidate = false;
    this.leaderId = this.selfId;
    this.journal.leaderId = this.selfId;
    this.lastLeaderSeen = Date.now();
    await this.persist();
    await this.multicast(
      { type: "LEADER", term: this.journal.term, voters: [...this.votes] },
      [...config.before, ...config.after],
    );
    const latest = this.journal.accepted ?? this.journal.committed!;
    const state = structuredClone(latest.state);
    state.ownerId = this.selfId;
    // Re-propose the freshest accepted snapshot in the new term. Do not discard an
    // acknowledged move just because the old host died before broadcasting COMMIT.
    await this.propose(
      await makeFrame(state, latest.index + 1, this.journal.term),
      config.before,
      config.after,
      `election-${this.journal.term}`,
      this.selfId,
    );
  }
  private async command(
    actorId: string,
    requestId: string,
    revision: number,
    action: GameAction | TimeoutAction,
  ) {
    try {
      if (this.processed.has(requestId)) return;
      if (this.pending)
        throw new Error("Another move is being confirmed. Try again shortly.");
      const frame = this.journal.committed;
      if (!frame || revision !== frame.index)
        throw new Error("The table changed. Try your action again.");
      // A delayed packet cannot extend an expired turn. Non-turn UNO messages
      // do not reset the deadline either.
      if (
        action.type !== "TIMEOUT" &&
        frame.state.phase === "playing" &&
        frame.state.turnDeadline != null &&
        Date.now() >= frame.state.turnDeadline
      ) {
        await this.expireTurn();
        throw new Error("The turn timer expired. Wait for the next turn.");
      }
      const state = reduceGame(frame.state, actorId, action, Date.now());
      const next = await makeFrame(state, frame.index + 1, this.journal.term);
      await this.propose(
        next,
        members(frame),
        members(next),
        requestId,
        actorId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Move rejected.";
      if (actorId === this.selfId) {
        this.outstandingUntil = 0;
        this.error(message);
      } else await this.send({ type: "ERROR", message }, actorId);
    }
  }
  private async propose(
    frame: Frame,
    before: string[],
    after: string[],
    requestId: string,
    actorId: string,
  ) {
    this.pending = {
      frame,
      before,
      after,
      requestId,
      actorId,
      votes: new Set([this.selfId]),
    };
    this.journal.accepted = frame;
    this.journal.before = before;
    this.journal.after = after;
    await this.persist();
    await this.multicast(
      {
        type: "PROPOSE",
        frame,
        before,
        after,
        term: this.journal.term,
        requestId,
      },
      [...before, ...after],
    );
    await this.tryCommit();
    this.publish();
  }
  private async tryCommit() {
    const p = this.pending;
    if (!p || !jointMajority(p.votes, p.before, p.after)) return;
    this.journal.committed = p.frame;
    this.journal.before = this.journal.after = p.after;
    await this.persist();
    this.processed.add(p.requestId);
    if (this.processed.size > 256)
      this.processed.delete(this.processed.values().next().value!);
    this.pending = null;
    this.readyLeader = true;
    this.outstandingUntil = 0;
    await this.multicast(
      { type: "COMMIT", hash: p.frame.hash, term: this.journal.term },
      p.after,
    );
    this.publish();
  }
  act(action: GameAction) {
    this.clearError();
    const view = useSession.getState();
    if (view.status !== "connected" || view.busy || !this.leaderId) {
      this.error(
        "Wait for the table to reconnect and confirm its current move.",
      );
      return;
    }
    this.outstandingUntil = Date.now() + 5000;
    this.publish();
    this.queue(async () => {
      const id = crypto.randomUUID();
      if (this.leaderId === this.selfId)
        await this.command(this.selfId, id, view.revision, action);
      else
        await this.send(
          { type: "COMMAND", id, revision: view.revision, action },
          this.leaderId!,
        );
      this.publish();
    });
  }
  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.transport?.close();
    this.transport = null;
    useSession.setState({ status: "closed", busy: false });
  }
}
