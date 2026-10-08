import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { makeDeck, reduceGame } from "../../src/lib/game/engine";
import { makeFrame, type Frame } from "../../src/lib/network/protocol";

async function table(
  context: BrowserContext,
  host: Page,
  count = 3,
  interceptHeartbeats = false,
) {
  const pages = [host];
  await host.goto("/");
  await host.getByLabel("Your display name").fill("Alice");
  await host.getByRole("button", { name: "Create a lobby" }).click();
  await host.getByLabel("Play together").selectOption("local");
  await expect(host).toHaveURL(/network=local/);
  await host.getByLabel("Time per turn").selectOption("0");
  await host.getByRole("button", { name: "Pick Cherry", exact: true }).click();
  await expect(
    host.getByRole("button", { name: "Pick Cherry", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const [name, color] of [
    ["Bob", "Cobalt"],
    ["Casey", "Lemon"],
  ].slice(0, count - 1)) {
    const peer = await context.newPage();
    if (interceptHeartbeats && name === "Bob")
      await peer.addInitScript(() => {
        const controls = window as Window & { suppressUnoHeartbeats?: boolean };
        controls.suppressUnoHeartbeats = false;
        const send = BroadcastChannel.prototype.postMessage;
        BroadcastChannel.prototype.postMessage = function (message: {
          message?: { type?: string };
        }) {
          if (
            controls.suppressUnoHeartbeats &&
            message.message?.type === "HELLO"
          )
            return;
          send.call(this, message);
        };
      });
    await peer.goto(host.url());
    await peer.getByLabel("Your display name").fill(name);
    await peer.getByRole("button", { name: "Join a lobby" }).click();
    await peer
      .getByRole("button", { name: `Pick ${color}`, exact: true })
      .click();
    await expect(
      peer.getByRole("button", { name: `Pick ${color}`, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    pages.push(peer);
  }
  return pages;
}

// Deterministic mid-round checkpoints keep rare card decisions reproducible.
// All interactions after recovery use real signed multiplayer commands.
async function checkpoint(
  context: BrowserContext,
  pages: Page[],
  hands: string[][],
  options: { stack?: boolean; draws?: string[] } = {},
) {
  const invite = pages[0].url();
  for (const page of pages) {
    await page.getByRole("button", { name: "I’m ready" }).click();
    await expect(page.getByRole("button", { name: "Unready" })).toBeEnabled();
  }
  const saved = await pages[0].evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("uno-web-v1");
      r.onsuccess = () => resolve(r.result);
    });
    const entries = await new Promise<{ key: string; committed: Frame }[]>(
      (resolve) => {
        const r = db.transaction("journals").objectStore("journals").getAll();
        r.onsuccess = () => resolve(r.result);
      },
    );
    db.close();
    return entries.find((e) =>
      e.key.startsWith(sessionStorage.getItem("uno-tab-v1")! + ":"),
    )!;
  });
  let state = reduceGame(
    saved.committed.state,
    saved.committed.state.ownerId,
    { type: "START", seed: 42 },
    0,
  );
  const deck = makeDeck();
  const take = (spec: string) => {
    const [color, value] = spec.split(":");
    const index = deck.findIndex(
      (c) => (c.color ?? "null") === color && c.value === value,
    );
    if (index < 0) throw new Error(`Missing fixture card: ${spec}`);
    return deck.splice(index, 1)[0];
  };
  state = {
    ...state,
    turn: 0,
    direction: 1,
    turnTimeoutSeconds: 0,
    turnDeadline: null,
    pendingWild: null,
    challenge: null,
    pendingDrawTwo: 0,
    activeColor: "red",
    hasDrawn: false,
    drawnCardId: null,
    unoVulnerable: null,
    unoCalled: [],
    discard: [take("red:5")],
    hands: Object.fromEntries(
      state.players.map((p, i) => [p.id, hands[i].map(take)]),
    ),
    animation: { id: state.animation.id + 10, events: [] },
  };
  state.rules.stackDrawTwo = options.stack ?? false;
  const draws = (options.draws ?? []).map(take);
  state.drawPile = [...deck, ...draws.reverse()];
  const frame = await makeFrame(
    state,
    saved.committed.index + 10,
    saved.committed.term + 1,
  );
  for (const page of pages) await page.goto("about:blank");
  const writer = await context.newPage();
  await writer.goto("/");
  await writer.evaluate(
    async ({ frame, room }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("uno-web-v1");
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("journals", "readwrite");
        const store = tx.objectStore("journals");
        const req = store.getAll();
        req.onsuccess = () => {
          for (const entry of req.result)
            if (entry.key.endsWith(`:${room}`))
              store.put({
                ...entry,
                term: frame.term,
                votedFor: null,
                leaderId: frame.state.ownerId,
                committed: frame,
                accepted: frame,
                before: frame.state.players.map((p) => p.id),
                after: frame.state.players.map((p) => p.id),
              });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    {
      frame,
      room: new URLSearchParams(new URL(invite).hash.slice(1)).get("room")!,
    },
  );
  await writer.close();
  await Promise.all(pages.map((page) => page.goto(invite)));
  for (const page of pages) {
    await expect(page.getByTestId("game-table")).toBeVisible();
    await expect(page.locator(".connection-status")).toContainText(
      "Connected",
      { timeout: 25000 },
    );
  }
}

async function idle(page: Page) {
  await expect(page.getByTestId("game-table")).toHaveAttribute(
    "data-animating",
    "false",
  );
}

test("UNO is explicit; Draw Four decisions and round results are focused mobile modals", async ({
  context,
  page,
}) => {
  test.setTimeout(90000);
  const [alice, bob, casey] = await table(context, page);
  await checkpoint(
    context,
    [alice, bob, casey],
    [
      ["red:7", "blue:8"],
      ["null:wild4", "yellow:4"],
      ["green:9", "green:3"],
    ],
  );
  await expect(alice.getByRole("checkbox")).toHaveCount(0);
  await expect(
    alice.getByRole("button", { name: "UNO!", exact: true }),
  ).toBeDisabled();
  await alice.getByRole("button", { name: "Play red 7", exact: true }).click();
  await expect(
    bob.getByRole("button", { name: "Catch UNO!", exact: true }),
  ).toBeEnabled();
  await expect(bob.locator(".uno-tag")).toHaveCount(0);
  await alice.getByRole("button", { name: "UNO!", exact: true }).click();
  await expect(bob.locator(".uno-tag")).toHaveText("UNO");
  await expect(
    bob.getByRole("button", { name: "Catch UNO!", exact: true }),
  ).toHaveCount(0);
  await idle(bob);
  await casey.setViewportSize({ width: 390, height: 844 });
  await casey.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await bob
    .getByRole("button", { name: "Play Wild Draw Four", exact: true })
    .click();
  await bob.getByRole("button", { name: "Choose blue", exact: true }).click();
  const challenge = casey.getByRole("dialog", {
    name: "A Wild Draw Four. Your call.",
  });
  await expect(challenge).toBeVisible();
  const box = await challenge.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await expect(
    challenge.getByRole("button", { name: "Accept four" }),
  ).toBeFocused();
  await casey.keyboard.press("Escape");
  await expect(challenge).toBeVisible();
  await casey.keyboard.press("Shift+Tab");
  await expect(challenge.locator("button").last()).toBeFocused();
  await casey.screenshot({
    path: "artifacts/challenge-mobile.png",
    fullPage: true,
  });
  await challenge
    .getByRole("button", { name: "Challenge", exact: true })
    .click();
  const evidence = casey.getByRole("dialog", { name: "The challenged hand" });
  await expect(evidence).toBeVisible();
  await expect(evidence).toContainText("Challenge failed");
  await evidence.getByRole("button", { name: "Back to the table" }).click();
  await idle(alice);
  await alice.getByRole("button", { name: "Play blue 8", exact: true }).click();
  for (const p of [alice, bob, casey])
    await expect(
      p.getByRole("dialog", { name: "Alice wins the round!" }),
    ).toBeVisible();
  const host = (
    await Promise.all(
      [alice, bob, casey].map(async (p) => ({
        p,
        host: await p
          .getByRole("button", { name: "Deal the next round" })
          .count(),
      })),
    )
  ).find((p) => p.host)!.p;
  await host.getByRole("button", { name: "Deal the next round" }).click();
  await expect(
    alice.getByRole("dialog", { name: "Alice wins the round!" }),
  ).toHaveCount(0);
});

test("signed targeted commands immediately recover a stale peer dot without waiting for heartbeats", async ({
  context,
  page,
}) => {
  test.setTimeout(45000);
  const [alice, bob, casey] = await table(context, page, 3, true);
  await expect(
    casey.getByRole("img", { name: "Bob: Stable connection" }),
  ).toBeVisible();
  await bob.evaluate(() => {
    (
      window as Window & { suppressUnoHeartbeats?: boolean }
    ).suppressUnoHeartbeats = true;
  });
  await expect(
    casey.getByRole("img", { name: "Bob: Unstable connection" }),
  ).toBeVisible({ timeout: 9000 });
  await expect(casey.getByRole("img", { name: "Bob: Offline" })).toBeVisible({
    timeout: 12000,
  });
  await expect(
    casey.getByText("Bob lost connection.", { exact: true }),
  ).toBeVisible();
  // Suppress only periodic HELLOs; signed gameplay commands still travel.
  await bob.getByRole("button", { name: "I’m ready" }).click();
  await expect(
    casey.getByRole("img", { name: "Bob: Stable connection" }),
  ).toBeVisible();
  await expect(
    casey.getByText("Bob reconnected.", { exact: true }),
  ).toBeVisible();
  await expect(casey.locator(".connection-notice")).toHaveCount(0);
  await bob.evaluate(() => {
    (
      window as Window & { suppressUnoHeartbeats?: boolean }
    ).suppressUnoHeartbeats = false;
  });
  await alice.getByRole("button", { name: "Leave table" }).click();
  await expect(casey.getByText(/new game master\./)).toBeVisible({
    timeout: 25000,
  });
  await expect(casey.getByText(/new game master\./)).not.toBeVisible({
    timeout: 10000,
  });
});

test("losing the table shows a transient notification and reconnecting shows recovery", async ({
  context,
  page,
}) => {
  test.setTimeout(45000);
  const [alice, bob] = await table(context, page, 2);
  await alice.getByRole("button", { name: "Leave table" }).click();
  const lost = bob.getByText("Connection lost. Reconnecting to the table…", {
    exact: true,
  });
  await expect(lost).toBeVisible({ timeout: 15000 });
  await expect(bob.locator(".connection-notice")).toHaveCount(0);
  await expect(lost).not.toBeVisible({ timeout: 10000 });
  await alice.getByRole("button", { name: "Join a lobby" }).click();
  await expect(
    bob.getByText("Connection restored. You’re back at the table.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 20000 });
});

test("stacking and playable drawn wilds use one decision modal at a time", async ({
  context,
  page,
}) => {
  test.setTimeout(80000);
  const [alice, bob, casey] = await table(context, page);
  await checkpoint(
    context,
    [alice, bob, casey],
    [
      ["red:draw2", "blue:2"],
      ["yellow:draw2", "green:8"],
      ["blue:7", "green:3"],
    ],
    {
      stack: true,
      draws: ["red:0", "yellow:0", "green:0", "blue:0", "null:wild"],
    },
  );
  await alice
    .getByRole("button", { name: "Play red Draw Two", exact: true })
    .click();
  const stack = bob.getByRole("dialog", {
    name: "Stack a +2 or take 2 cards.",
  });
  await expect(stack).toBeVisible();
  await stack
    .getByRole("button", { name: "Play yellow Draw Two", exact: true })
    .click();
  const penalty = casey.getByRole("dialog", {
    name: "Stack a +2 or take 4 cards.",
  });
  await expect(penalty).toBeVisible();
  await penalty
    .getByRole("button", { name: "Take 4 cards", exact: true })
    .click();
  await alice
    .getByRole("button", { name: "Draw one card", exact: true })
    .click();
  const drawn = alice.getByRole("dialog", { name: "Play the card you drew?" });
  await expect(drawn).toBeVisible();
  await drawn.getByRole("button", { name: "Play Wild", exact: true }).click();
  await expect(alice.getByRole("dialog")).toHaveCount(1);
  await expect(
    alice.getByRole("dialog", { name: "Pick the next color." }),
  ).toBeVisible();
  await alice
    .getByRole("button", { name: "Choose green", exact: true })
    .click();
  await expect(alice.getByRole("dialog")).toHaveCount(0);
  await expect(
    alice.getByRole("button", { name: "UNO!", exact: true }),
  ).toBeEnabled();
});
