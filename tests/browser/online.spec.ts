import { expect, test } from "@playwright/test";

test("online invite establishes WebRTC and replicates lobby readiness", async ({
  context,
  page,
}) => {
  test.skip(
    !process.env.UNO_TEST_ONLINE,
    "Opt-in: depends on public Nostr relays and WebRTC networking.",
  );
  test.setTimeout(120000);
  await page.goto("/");
  await page.getByLabel("Your display name").fill("Online host");
  await page.getByLabel("Seats at the table").selectOption("2");
  await page.getByRole("button", { name: "Create a lobby" }).click();
  await expect(
    page.getByRole("heading", { name: "Your table is taking shape." }),
  ).toBeVisible();
  const guest = await context.newPage();
  await guest.goto(page.url());
  await guest.getByLabel("Your display name").fill("Online guest");
  await guest.getByRole("button", { name: "Join a lobby" }).click();
  await expect(guest.getByRole("button", { name: "I’m ready" })).toBeEnabled({
    timeout: 90000,
  });
  await guest.getByRole("button", { name: "I’m ready" }).click();
  await expect(guest.getByRole("button", { name: "Unready" })).toBeEnabled();
  await expect(page.getByText("Online guest", { exact: true })).toBeVisible();
});
