import { expect, test, type Page } from "@playwright/test";

async function journal(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("uno-web-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const values = await new Promise<
      Array<{
        key: string;
        term: number;
        leaderId: string;
        committed: {
          index: number;
          hash: string;
          state: {
            ownerId: string;
            turn: number;
            turnSerial: number;
            turnDeadline: number | null;
            turnTimeoutSeconds: number;
            players: Array<{ id: string; name: string }>;
            drawPile: unknown[];
            discard: unknown[];
            hands: Record<string, unknown[]>;
          };
        };
      }>
    >((resolve, reject) => {
      const request = db
        .transaction("journals")
        .objectStore("journals")
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return values.find((value) =>
      value.key.startsWith(sessionStorage.getItem("uno-tab-v1")! + ":"),
    )!;
  });
}

test("local multiplayer: admission, capacity, deal, host recovery, reconnect, and a move", async ({
  context,
  page,
}) => {
  const errors: string[] = [];
  context.on("page", (p) =>
    p.on("pageerror", (error) => errors.push(error.message)),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Your display name").fill("Alice");
  await expect(page.getByLabel("Seats at the table")).toHaveCount(0);
  await page.getByRole("button", { name: "Create a lobby" }).click();
  await expect(
    page.getByRole("heading", { name: "Game night starts here." }),
  ).toBeVisible();
  await page.getByLabel("Play together").selectOption("local");
  await expect(page).toHaveURL(/network=local/);
  await page.getByLabel("Time per turn").selectOption("0");
  await page.getByLabel("Seats at the table").selectOption("3");
  await page.getByRole("button", { name: "Pick Cherry", exact: true }).click();
  await page.getByLabel("Win by", { exact: true }).selectOption("rounds");
  await expect(
    page.getByText("First to 3 round wins.", { exact: true }),
  ).toBeVisible();
  const invite = page.url();
  const bob = await context.newPage();
  await bob.goto(invite);
  await bob.getByLabel("Your display name").fill("Bob");
  await bob.getByRole("button", { name: "Join a lobby" }).click();
  await expect(
    bob.getByRole("button", { name: "Pick Cherry · taken by Alice" }),
  ).toBeDisabled();
  await bob.getByRole("button", { name: "Pick Cobalt", exact: true }).click();
  await expect(bob.getByRole("button", { name: "I’m ready" })).toBeEnabled();
  const casey = await context.newPage();
  await casey.goto(invite);
  await casey.getByLabel("Your display name").fill("Casey");
  await casey.getByRole("button", { name: "Join a lobby" }).click();
  await casey.getByRole("button", { name: "Pick Lemon", exact: true }).click();
  await expect(casey.getByRole("button", { name: "I’m ready" })).toBeEnabled();
  await expect(page.getByText("3/3", { exact: true })).toBeVisible();
  await expect(page.getByText("Casey", { exact: true })).toBeVisible();
  const fourth = await context.newPage();
  await fourth.goto(invite);
  await fourth.getByLabel("Your display name").fill("Dana");
  await fourth.getByRole("button", { name: "Join a lobby" }).click();
  await expect(fourth.locator(".error-box")).toContainText("full");
  await fourth.close();
  for (const p of [page, bob, casey]) {
    await expect(p.getByRole("button", { name: "I’m ready" })).toBeEnabled();
    await p.getByRole("button", { name: "I’m ready" }).click();
    await expect(p.getByRole("button", { name: "Unready" })).toBeEnabled();
  }
  await page.getByRole("switch", { name: "Stack Draw Two" }).click();
  for (const p of [page, bob, casey]) {
    await expect(p.getByRole("button", { name: "I’m ready" })).toBeEnabled();
    await p.getByRole("button", { name: "I’m ready" }).click();
    await expect(p.getByRole("button", { name: "Unready" })).toBeEnabled();
  }
  await page.screenshot({
    path: "artifacts/lobby-tabletop.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Deal the cards" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Deal the cards" }).click();
  for (const p of [page, bob, casey])
    await expect(
      p.getByRole("heading", { name: "First to 3 round wins." }),
    ).toBeVisible();
  await expect(page.getByTestId("game-table")).toHaveAttribute(
    "data-animating",
    "false",
  );
  const before = await journal(bob);
  await expect
    .poll(async () => (await journal(casey)).committed.hash)
    .toBe(before.committed.hash);
  const beforeCards = before.committed.state;
  expect(
    beforeCards.drawPile.length +
      beforeCards.discard.length +
      Object.values(beforeCards.hands).flat().length,
  ).toBe(108);
  await page.screenshot({
    path: "artifacts/table-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Leave table" }).click();
  await expect
    .poll(async () => (await journal(bob)).term, { timeout: 30000 })
    .toBeGreaterThan(before.term);
  await expect
    .poll(async () => (await journal(bob)).committed.state.ownerId, {
      timeout: 30000,
    })
    .not.toBe(beforeCards.ownerId);
  await expect
    .poll(async () => (await journal(casey)).committed.hash)
    .toBe((await journal(bob)).committed.hash);
  const recovered = (await journal(bob)).committed.state;
  expect(recovered.hands).toEqual(beforeCards.hands);
  expect(recovered.drawPile).toEqual(beforeCards.drawPile);
  await page.getByRole("button", { name: "Join a lobby" }).click();
  await expect(
    page.getByRole("heading", { name: "First to 3 round wins." }),
  ).toBeVisible({ timeout: 20000 });
  await expect
    .poll(async () => (await journal(page)).committed.hash)
    .toBe((await journal(bob)).committed.hash);
  // Reload an admitted peer: identity, term, and seat must survive browser storage recovery.
  await casey.reload();
  await expect(
    casey.getByRole("heading", { name: "First to 3 round wins." }),
  ).toBeVisible();
  for (const p of [page, bob, casey])
    await expect(p.locator(".connection-status")).toContainText("Connected", {
      timeout: 20000,
    });
  const active = await Promise.all(
    [page, bob, casey].map(async (p) => ({
      p,
      active: await p
        .getByRole("heading", { name: "Your turn.", exact: true })
        .isVisible(),
    })),
  );
  const turnPage = active.find((p) => p.active)!.p;
  await expect(turnPage.getByTestId("game-table")).toHaveAttribute(
    "data-animating",
    "false",
  );
  const chooseColor = turnPage.getByRole("dialog", {
    name: "Pick the next color.",
  });
  if (await chooseColor.isVisible()) {
    await turnPage
      .getByRole("button", { name: "Choose red", exact: true })
      .click();
    await expect(chooseColor).not.toBeVisible();
  }
  const revision = (await journal(turnPage)).committed.index;
  await expect(
    turnPage.getByRole("button", { name: "Draw one card" }),
  ).toBeEnabled();
  const cardSize = await turnPage
    .locator(".hand-card .playing-card")
    .first()
    .boundingBox();
  const boardSize = await turnPage.locator(".game-board").boundingBox();
  await turnPage.getByRole("button", { name: "Draw one card" }).click();
  await expect(turnPage.getByTestId("card-animation")).toBeVisible();
  await expect(turnPage.getByTestId("card-animation")).not.toBeVisible();
  const endTurn = turnPage.getByRole("button", {
    name: "End turn",
    exact: true,
  });
  if (await endTurn.isEnabled()) await endTurn.click();
  await expect(turnPage.getByTestId("turn-announcement")).toBeVisible();
  await expect(
    turnPage.getByRole("button", { name: "Draw one card" }),
  ).toBeDisabled();
  await expect(turnPage.getByTestId("game-table")).toHaveAttribute(
    "data-animating",
    "false",
  );
  const nextCardSize = await turnPage
    .locator(".hand-card .playing-card")
    .first()
    .boundingBox();
  const nextBoardSize = await turnPage.locator(".game-board").boundingBox();
  expect(nextCardSize!.width).toBeCloseTo(cardSize!.width, 0);
  expect(nextCardSize!.height).toBeCloseTo(cardSize!.height, 0);
  expect(nextBoardSize!.width).toBeCloseTo(boardSize!.width, 0);
  expect(nextBoardSize!.height).toBeCloseTo(boardSize!.height, 0);
  await expect
    .poll(async () => (await journal(turnPage)).committed.index)
    .toBeGreaterThan(revision);
  await expect
    .poll(async () => (await journal(bob)).committed.hash)
    .toBe((await journal(turnPage)).committed.hash);
  expect(errors).toEqual([]);
});

test("mobile landing renders and validates names and invites", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Create a lobby" }).click();
  await expect(page.locator(".error-box")).toContainText("display name");
  await page.getByLabel("Your display name").fill("Alex");
  await page.getByLabel("Invite link").fill("https://example.com/#invalid");
  await page.getByRole("button", { name: "Join a lobby" }).click();
  await expect(page.locator(".error-box")).toBeVisible();
  await page.getByRole("button", { name: "How to play" }).click();
  await expect(
    page.getByRole("dialog", { name: "The rulebook" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/landing-mobile.png",
    fullPage: true,
  });
});

test("a large mobile hand keeps fixed card and board sizes with reduced motion", async ({
  context,
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByLabel("Your display name").fill("Alex");
  await page.getByRole("button", { name: "Create a lobby" }).click();
  await page.getByLabel("Play together").selectOption("local");
  await expect(page).toHaveURL(/network=local/);
  await page.getByRole("button", { name: "Pick Cherry", exact: true }).click();
  const guest = await context.newPage();
  await guest.emulateMedia({ reducedMotion: "reduce" });
  await guest.goto(page.url());
  await guest.getByLabel("Your display name").fill("Sam");
  await guest.getByRole("button", { name: "Join a lobby" }).click();
  await guest.getByRole("button", { name: "Pick Cobalt", exact: true }).click();
  for (const p of [page, guest]) {
    await p.getByRole("button", { name: "I’m ready" }).click();
    await expect(p.getByRole("button", { name: "Unready" })).toBeEnabled();
  }
  await page.getByRole("button", { name: "Deal the cards" }).click();
  await expect(page.getByTestId("game-table")).toHaveAttribute(
    "data-animating",
    "false",
  );
  const originalCard = await page
    .locator(".hand-card .playing-card")
    .first()
    .boundingBox();
  const originalBoard = await page.locator(".game-board").boundingBox();
  for (
    let i = 0;
    i < 65 && (await page.locator(".hand-card").count()) < 20;
    i++
  ) {
    for (const p of [page, guest])
      await expect(p.getByTestId("game-table")).toHaveAttribute(
        "data-animating",
        "false",
      );
    const active = (await page
      .getByRole("heading", { name: "Your turn.", exact: true })
      .isVisible())
      ? page
      : guest;
    const color = active.getByRole("button", {
      name: "Choose red",
      exact: true,
    });
    if (await color.isVisible()) {
      await color.click();
      continue;
    }
    const revision = (await journal(active)).committed.index;
    const pass = active.getByRole("button", { name: "End turn", exact: true });
    if (await pass.isEnabled()) await pass.click();
    else await active.getByRole("button", { name: "Draw one card" }).click();
    await expect
      .poll(async () => (await journal(active)).committed.index)
      .toBeGreaterThan(revision);
    await expect(active.locator(".connection-status")).toContainText(
      "Connected",
    );
    await expect(active.getByTestId("game-table")).toHaveAttribute(
      "data-animating",
      "false",
    );
  }
  await expect(page.locator(".hand-card")).toHaveCount(20);
  const card = await page
    .locator(".hand-card .playing-card")
    .first()
    .boundingBox();
  const board = await page.locator(".game-board").boundingBox();
  expect(card!.width).toBeCloseTo(originalCard!.width, 0);
  expect(card!.height).toBeCloseTo(originalCard!.height, 0);
  expect(board!.width).toBeCloseTo(originalBoard!.width, 0);
  expect(board!.height).toBeCloseTo(originalBoard!.height, 0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".hand-scroll")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "Scroll hand right" }).click();
  await expect
    .poll(() => page.locator(".hand-scroll").evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  await expect(page.getByTestId("card-animation")).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/table-mobile-large-hand.png",
    fullPage: true,
  });
});

test("reload restores lobby settings, readiness, and an active playable hand without advancing unlimited turns", async ({
  context,
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page.getByLabel("Your display name").fill("Host");
  await page.getByRole("button", { name: "Create a lobby" }).click();
  await expect(page.getByLabel("Time per turn")).toHaveValue("30");
  await page.getByLabel("Play together").selectOption("local");
  await expect(page).toHaveURL(/network=local/);
  await page.getByLabel("Time per turn").selectOption("0");
  await page.getByRole("button", { name: "Pick Cherry", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Time per turn")).toHaveValue("0");
  await expect(
    page.getByRole("button", { name: "Pick Cherry", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "I’m ready" })).toBeEnabled({
    timeout: 20000,
  });
  const guest = await context.newPage();
  await guest.goto(page.url());
  await guest.getByLabel("Your display name").fill("Guest");
  await guest.getByRole("button", { name: "Join a lobby" }).click();
  await guest.getByRole("button", { name: "Pick Cobalt", exact: true }).click();
  await guest.getByRole("button", { name: "I’m ready" }).click();
  await expect(guest.getByRole("button", { name: "Unready" })).toBeEnabled();
  await guest.reload();
  await expect(guest.getByRole("button", { name: "Unready" })).toBeEnabled({
    timeout: 20000,
  });
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Deal the cards" }).click();
  await expect(page.getByTestId("card-animation")).toBeVisible();
  const pages = [page, guest];
  for (let tries = 0; tries < 8; tries++) {
    for (const p of pages)
      await expect(p.getByTestId("game-table")).toHaveAttribute(
        "data-animating",
        "false",
      );
    const active = (await page
      .getByRole("heading", { name: "Your turn.", exact: true })
      .isVisible())
      ? page
      : guest;
    const choose = active.getByRole("button", {
      name: "Choose red",
      exact: true,
    });
    if (await choose.isVisible()) {
      await choose.click();
      continue;
    }
    if (await active.locator(".hand-card button:enabled").count()) break;
    const pass = active.getByRole("button", { name: "End turn", exact: true });
    const before = (await journal(active)).committed.index;
    if (await pass.isEnabled()) await pass.click();
    else await active.getByRole("button", { name: "Draw one card" }).click();
    await expect
      .poll(async () => (await journal(active)).committed.index)
      .toBeGreaterThan(before);
  }
  for (const p of pages)
    await expect(p.getByTestId("game-table")).toHaveAttribute(
      "data-animating",
      "false",
    );
  const active = (await page
    .getByRole("heading", { name: "Your turn.", exact: true })
    .isVisible())
    ? page
    : guest;
  const cardName = await active
    .locator(".hand-card button:enabled")
    .first()
    .getAttribute("aria-label");
  expect(cardName).toBeTruthy();
  const before = (await journal(active)).committed.state;
  // Reload both roles: the host must recover authority and the guest its exact seat.
  for (const p of pages) {
    await p.reload();
    await expect(p.getByTestId("game-table")).toBeVisible();
    await expect(p.locator(".connection-status")).toContainText("Connected", {
      timeout: 25000,
    });
    await expect(p.getByTestId("game-table")).toHaveAttribute(
      "data-animating",
      "false",
    );
  }
  const after = (await journal(active)).committed.state;
  expect(after.turnSerial).toBe(before.turnSerial);
  expect(after.turn).toBe(before.turn);
  expect(after.hands).toEqual(before.hands);
  expect(after.turnDeadline).toBeNull();
  await expect(
    active.getByRole("heading", { name: "Your turn.", exact: true }),
  ).toBeVisible();
  const card = active
    .getByRole("button", { name: cardName!, exact: true })
    .first();
  await expect(card).toBeEnabled();
  const revision = (await journal(active)).committed.index;
  await card.click();
  const choose = active.getByRole("button", {
    name: "Choose red",
    exact: true,
  });
  if (await choose.isVisible()) await choose.click();
  await expect
    .poll(async () => (await journal(active)).committed.index)
    .toBeGreaterThan(revision);
  await active.getByRole("button", { name: "Leave table" }).click();
  await active.reload();
  await expect(
    active.getByRole("button", { name: "Join a lobby" }),
  ).toBeVisible();
});

test("the persisted 30-second deadline survives reload; a disconnected player is skipped only when it expires", async ({
  context,
  page,
}) => {
  test.setTimeout(100000);
  await page.goto("/");
  await page.getByLabel("Your display name").fill("Clock host");
  await page.getByRole("button", { name: "Create a lobby" }).click();
  await page.getByLabel("Play together").selectOption("local");
  await expect(page).toHaveURL(/network=local/);
  const pages = [page];
  for (const [name, color] of [
    ["Second", "Cobalt"],
    ["Third", "Lemon"],
  ]) {
    const guest = await context.newPage();
    await guest.goto(page.url());
    await guest.getByLabel("Your display name").fill(name);
    await guest.getByRole("button", { name: "Join a lobby" }).click();
    await guest
      .getByRole("button", { name: `Pick ${color}`, exact: true })
      .click();
    await guest.getByRole("button", { name: "I’m ready" }).click();
    await expect(guest.getByRole("button", { name: "Unready" })).toBeEnabled();
    pages.push(guest);
  }
  await page.getByRole("button", { name: "Pick Cherry", exact: true }).click();
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Deal the cards" }).click();
  for (const p of pages)
    await expect(p.getByTestId("game-table")).toHaveAttribute(
      "data-animating",
      "false",
    );
  const before = (await journal(page)).committed.state;
  const active = (
    await Promise.all(
      pages.map(async (p) => ({
        p,
        active: await p
          .getByRole("heading", { name: "Your turn.", exact: true })
          .isVisible(),
      })),
    )
  ).find((p) => p.active)!.p;
  for (const p of new Set([page, active])) {
    await p.reload();
    await expect(p.getByTestId("game-table")).toBeVisible();
    await expect(p.locator(".connection-status")).toContainText("Connected", {
      timeout: 20000,
    });
  }
  const restored = (await journal(active)).committed.state;
  expect(restored.turnDeadline).toBe(before.turnDeadline);
  expect(restored.turnSerial).toBe(before.turnSerial);
  expect(restored.hands).toEqual(before.hands);
  await expect(active.getByRole("timer")).toHaveAttribute(
    "data-deadline",
    String(before.turnDeadline),
  );
  const observer = pages.find((p) => p !== active)!;
  await active.close();
  // Observe every committed update until expiry; losing a peer is not a turn action.
  while (Date.now() < before.turnDeadline! - 300) {
    expect((await journal(observer)).committed.state.turnSerial).toBe(
      before.turnSerial,
    );
    await observer.waitForTimeout(250);
  }
  await expect
    .poll(async () => (await journal(observer)).committed.state.turnSerial, {
      timeout: 15000,
    })
    .toBe(before.turnSerial + 1);
  const expired = (await journal(observer)).committed.state;
  expect(expired.turn).not.toBe(before.turn);
  expect(expired.hands).toEqual(before.hands);
  expect(expired.turnDeadline).toBeGreaterThan(before.turnDeadline!);
});
