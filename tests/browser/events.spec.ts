import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import postgres from "postgres";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

dotenv.config({ path: ".env.local", quiet: true });

const fixtureIds: string[] = [];
let database: ReturnType<typeof postgres>;

test.beforeAll(() => {
  const connection = process.env.DATABASE_URL;
  if (
    !connection ||
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)
  ) {
    throw new Error(
      "Event browser tests require a local PostgreSQL database. Remote databases are never used for fixture cleanup.",
    );
  }
  database = postgres(connection, { max: 1 });
});

test.afterEach(async () => {
  for (const id of fixtureIds.splice(0)) {
    await database.begin(async (transaction) => {
      const [event] =
        await transaction`SELECT title FROM events WHERE id=${id}`;
      if (!event) return;
      if (!event.title.startsWith("browser-e2e-"))
        throw new Error(
          "Refusing to remove an event not created by this test.",
        );
      await transaction`DELETE FROM notifications WHERE resource_id=${id}`;
      await transaction`DELETE FROM reports WHERE target_type='event' AND target_id=${id}`;
      await transaction`DELETE FROM audit_events WHERE target_id=${id}`;
      await transaction`DELETE FROM event_updates WHERE event_id=${id}`;
      await transaction`DELETE FROM saved_events WHERE event_id=${id}`;
      await transaction`DELETE FROM event_rsvps WHERE event_id=${id}`;
      await transaction`DELETE FROM event_invitations WHERE event_id=${id}`;
      await transaction`DELETE FROM events WHERE id=${id}`;
    });
  }
});

test.afterAll(async () => {
  await database?.end();
});

async function login(
  context: BrowserContext,
  baseURL: string,
  persona: "alex" | "morgan" | "jamie",
) {
  expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL).hostname);
  const response = await context.request.post(`${baseURL}/api/auth/dev-login`, {
    headers: { Origin: new URL(baseURL).origin },
    data: { persona },
  });
  expect(response.status()).toBe(200);
}

async function mutation(page: Page, click: () => Promise<unknown>) {
  const pending = page.waitForResponse((response) =>
    response.url().endsWith("/api/actions"),
  );
  await click();
  const response = await pending;
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body;
}

function futureWallTime(hour: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 14);
  return `${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00`;
}

async function fillCommonFields(page: Page, title: string) {
  const dialog = page.getByRole("dialog");
  await dialog.locator('[name="title"]').fill(title);
  await dialog
    .locator('[name="description"]')
    .fill(
      "Fictional local browser-test gathering. This temporary fixture verifies the complete event workflow.",
    );
  await dialog.locator('[name="startsAt"]').fill(futureWallTime(17));
  await dialog.locator('[name="endsAt"]').fill(futureWallTime(19));
  await dialog.locator('[name="venue"]').fill("Hayes Valley");
  return dialog;
}

test("event discovery, timezone filters, calendar layouts and mobile dialogs fit the viewport", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await login(context, baseURL!, "alex");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/events");
  await expect(
    page.getByRole("heading", { name: "Events", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ev-card").first()).toBeVisible();
  await page.getByLabel("Filter by city").selectOption("San Francisco");
  expect(await page.locator(".ev-card").count()).toBeGreaterThan(0);
  for (const card of await page.locator(".ev-card").all()) {
    await expect(card.locator(".ev-location")).toContainText("San Francisco");
  }
  await expect(page).toHaveURL(/city=San\+Francisco/);
  await page.reload();
  await expect(page.getByLabel("Filter by city")).toHaveValue("San Francisco");
  await page.getByLabel("Filter by city").selectOption("All cities");
  await page.getByRole("button", { name: "month view", exact: true }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(42);
  await page.getByRole("button", { name: "week view", exact: true }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(7);
  await page.getByRole("button", { name: "agenda view", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("events-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".ev-card").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("events-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.locator(".ev-card").first().click();
  await expect(page.locator(".ev-detail-content h1")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("event-detail-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "All events", exact: true }).click();
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("event-create-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("native events persist across RSVP approval, venue access, edits, updates and cancellation", async ({
  page: host,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  host.on("pageerror", (error) => errors.push(error.message));
  await login(context, baseURL!, "alex");
  await host.goto("/events");
  await host.getByRole("button", { name: "Create event", exact: true }).click();
  const title = `browser-e2e-native-${randomUUID().slice(0, 8)}`;
  let dialog = await fillCommonFields(host, title);
  await dialog
    .locator('[name="exactAddress"]')
    .fill("Private fictional browser-test venue");
  await dialog.locator('[name="capacity"]').fill("1");
  await dialog.locator('[name="requiresApproval"]').check();
  const created = await mutation(host, () =>
    dialog.getByRole("button", { name: "Publish event" }).click(),
  );
  const id: string = created.event.id;
  fixtureIds.push(id);
  await expect(dialog).not.toBeVisible();
  await host.locator(".ev-card").filter({ hasText: title }).click();

  const guestContext = await browser.newContext({
    baseURL,
    colorScheme: "dark",
  });
  try {
    await login(guestContext, baseURL!, "morgan");
    const guest = await guestContext.newPage();
    guest.on("pageerror", (error) => errors.push(error.message));
    await guest.goto(`/e/${id}`);
    await expect(
      guest.getByText("Exact location shared with confirmed guests"),
    ).toBeVisible();
    await expect(
      guest.getByText("Private fictional browser-test venue"),
    ).toHaveCount(0);
    await mutation(guest, () =>
      guest
        .getByRole("button", { name: "Request to join", exact: true })
        .click(),
    );
    await expect(
      guest.getByRole("heading", { name: "Awaiting approval" }),
    ).toBeVisible();
    await host
      .getByRole("button", { name: "Manage event", exact: true })
      .click();
    await mutation(host, () =>
      host
        .getByRole("button", { name: "Approve Morgan Studio", exact: true })
        .click(),
    );
    await guest.reload();
    await expect(
      guest.getByRole("heading", { name: "You're going", exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByText("Private fictional browser-test venue"),
    ).toBeVisible();
    const calendar = await guestContext.request.get(
      `/api/events/${id}/calendar`,
    );
    expect(calendar.status()).toBe(200);
    expect(await calendar.text()).toContain("BEGIN:VCALENDAR");

    await host.getByRole("button", { name: "Edit event", exact: true }).click();
    dialog = host.getByRole("dialog");
    await dialog.locator('[name="capacity"]').fill("2");
    await dialog.locator('[name="title"]').fill(`${title}-updated`);
    await mutation(host, () =>
      dialog.getByRole("button", { name: "Save changes", exact: true }).click(),
    );
    await expect(dialog).not.toBeVisible();
    await expect(host.locator(".ev-detail-content h1")).toHaveText(
      `${title}-updated`,
    );
    const announcement =
      "Please bring a work in progress and one question for the room.";
    await host
      .getByPlaceholder("Something your guests should know...")
      .fill(announcement);
    await mutation(host, () =>
      host
        .getByRole("button", { name: "Send update to guests", exact: true })
        .click(),
    );
    await expect(host.getByText(announcement, { exact: true })).toBeVisible();
    await mutation(guest, () =>
      guest.getByRole("button", { name: "Save event", exact: true }).click(),
    );
    await expect(
      guest.getByRole("button", { name: "Unsave event", exact: true }),
    ).toBeVisible();
    await host
      .getByRole("button", { name: "Close registration", exact: true })
      .click();
    await mutation(host, () =>
      host
        .getByRole("button", { name: "Confirm closure", exact: true })
        .click(),
    );
    await expect(
      host.getByRole("heading", {
        name: "Registration is closed",
        exact: true,
      }),
    ).toBeVisible();
    await mutation(guest, () =>
      guest
        .getByRole("button", { name: "Withdraw registration", exact: true })
        .click(),
    );
    await host
      .getByRole("button", { name: "Cancel this event", exact: true })
      .click();
    await mutation(host, () =>
      host
        .getByRole("button", { name: "Confirm cancellation", exact: true })
        .click(),
    );
    await expect(
      host.getByRole("heading", {
        name: "This gathering was canceled",
        exact: true,
      }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await guestContext.close();
  }
});

test("external event interest is separate from provider RSVPs and reports remain private", async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!, "alex");
  await page.goto("/events");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add external event", exact: true })
    .click();
  const title = `browser-e2e-external-${randomUUID().slice(0, 8)}`;
  const dialog = await fillCommonFields(page, title);
  await dialog
    .locator('[name="externalUrl"]')
    .fill("https://example.com/reddix-browser-test");
  await dialog
    .locator('[name="sourceLabel"]')
    .selectOption("Organizer website");
  const created = await mutation(page, () =>
    dialog.getByRole("button", { name: "Publish event" }).click(),
  );
  fixtureIds.push(created.event.id);
  await expect(dialog).not.toBeVisible();
  await page.locator(".ev-card").filter({ hasText: title }).click();
  await expect(
    page.getByRole("link", { name: "RSVP on Organizer website" }),
  ).toHaveAttribute("href", "https://example.com/reddix-browser-test");
  await expect(
    page.getByText(
      "RSVP with the organizer. Interest shown here is self-reported by Reddix members.",
    ),
  ).toBeVisible();
  await mutation(page, () =>
    page
      .getByRole("button", { name: "I'm interested on Reddix", exact: true })
      .click(),
  );
  await expect(
    page.getByRole("button", { name: "Remove my interest", exact: true }),
  ).toBeVisible();
  await mutation(page, () =>
    page
      .getByRole("button", { name: "Remove my interest", exact: true })
      .click(),
  );
  await expect(
    page.getByRole("button", { name: "I'm interested on Reddix", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Report this event", exact: true })
    .click();
  await mutation(page, () =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Send report", exact: true })
      .click(),
  );
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Report received." }),
  ).toBeVisible();
});

test("browse-only accounts can discover events but cannot create or register", async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!, "jamie");
  await page.goto("/events");
  await expect(page.locator(".ev-card").first()).toBeVisible();
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Good gatherings start with verified people.",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Keep exploring", exact: true })
    .click();
  await page.locator(".ev-card").first().click();
  await expect(
    page.getByRole("button", {
      name: "X verification required to RSVP",
      exact: true,
    }),
  ).toBeDisabled();
});
