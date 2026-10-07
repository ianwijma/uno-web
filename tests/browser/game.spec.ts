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
  await page.getByLabel("Seats at the table").selectOption("3");
  await page.getByLabel("Connection", { exact: true }).selectOption("local");
  await page.getByRole("button", { name: "Create a lobby" }).click();
  await expect(
    page.getByRole("heading", { name: "Your table is taking shape." }),
  ).toBeVisible();
  const invite = page.url();
  const bob = await context.newPage();
  await bob.goto(invite);
  await bob.getByLabel("Your display name").fill("Bob");
  await bob.getByRole("button", { name: "Join a lobby" }).click();
  await expect(bob.getByRole("button", { name: "I’m ready" })).toBeEnabled();
  const casey = await context.newPage();
  await casey.goto(invite);
  await casey.getByLabel("Your display name").fill("Casey");
  await casey.getByRole("button", { name: "Join a lobby" }).click();
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
  await expect(
    page.getByRole("button", { name: "Start the game" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Start the game" }).click();
  for (const p of [page, bob, casey])
    await expect(
      p.getByRole("heading", { name: "Race to 500." }),
    ).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Race to 500." })).toBeVisible(
    { timeout: 20000 },
  );
  await expect
    .poll(async () => (await journal(page)).committed.hash)
    .toBe((await journal(bob)).committed.hash);
  // Reload an admitted peer: identity, term, and seat must survive browser storage recovery.
  await casey.reload();
  await casey.getByRole("button", { name: "Join a lobby" }).click();
  await expect(
    casey.getByRole("heading", { name: "Race to 500." }),
  ).toBeVisible();
  for (const p of [page, bob, casey])
    await expect(p.locator(".connection-status")).toContainText("Connected", {
      timeout: 20000,
    });
  const active = await Promise.all(
    [page, bob, casey].map(async (p) => ({
      p,
      active: await p
        .getByRole("heading", { name: "Your move.", exact: true })
        .isVisible(),
    })),
  );
  const turnPage = active.find((p) => p.active)!.p;
  const chooseColor = turnPage.getByRole("dialog", {
    name: "Pick your color.",
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
  await turnPage.getByRole("button", { name: "Draw one card" }).click();
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
    page.getByRole("dialog", { name: "The classic rules." }),
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
