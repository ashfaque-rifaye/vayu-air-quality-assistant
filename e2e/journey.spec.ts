import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const TABS = ["Overview", "Exposure", "Routine", "Measures", "Swaps", "Ask Vayu"];

async function createPlan(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Household name").fill("The Mehta family");
  await page.getByLabel("City").fill("Delhi");
  await page.getByLabel("Person 1").fill("Zainab");
  await page.getByLabel("How do you commute?").selectOption("cycle");
  await page.getByRole("button", { name: "Build my clean-air plan" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Mehta family" })).toBeVisible();
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

test("a household gets a full clean-air plan end to end on the offline planner", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Try: Delhi family" }).click();
  await page.getByRole("button", { name: /Fill in the details/ }).click();
  await expect(page.getByTestId("interpret-result").getByTestId("ai-source")).toHaveText(
    "Offline planner",
  );
  await expect(page.getByLabel("City")).toHaveValue("Delhi");
  await expect(page.getByLabel("How do you commute?")).toHaveValue("cycle");
  await expect(page.getByLabel("Leaves home at")).toHaveValue("08:00");

  await page.getByLabel("Household name").fill("The Mehta family");
  await page.getByRole("button", { name: "Build my clean-air plan" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Mehta family" })).toBeVisible();
  await expect(page.getByTestId("personalization")).toContainText("Offline planner");
  await expect(page.getByRole("heading", { name: /Protection:/ })).toBeVisible();

  // The direct impact: the dose, its sources, and a review that adopts a measure.
  await page.getByRole("tab", { name: "Exposure" }).click();
  await expect(page.getByText("Doing nothing", { exact: true })).toBeVisible();
  await expect(page.getByText("WHO safe target")).toBeVisible();
  await page.getByRole("button", { name: "Review my exposure" }).click();
  await expect(page.getByTestId("exposure-review")).toContainText("safe daily limit");

  // A manual reading changes the air everywhere.
  await page.getByLabel(/Set today's average PM2.5/).fill("25");
  await page.getByLabel(/Set today's average PM2.5/).blur();
  await expect(page.getByText("Your figure")).toBeVisible();

  await page.getByRole("tab", { name: "Routine" }).click();
  await page.getByRole("button", { name: "Rebuild" }).click();
  await expect(page.getByText(/Air out the home/)).toBeVisible();
  await page.getByRole("button", { name: "Write it" }).click();
  await expect(page.getByTestId("daysheet")).toBeVisible();

  await page.getByRole("tab", { name: "Measures" }).click();
  await page.getByLabel("Status").first().selectOption("done");
  await page.getByRole("button", { name: "Get tailored guidance" }).first().click();
  await expect(page.getByTestId("measure-guide").first()).toBeVisible();

  await page.getByRole("tab", { name: "Swaps" }).click();
  await page.getByRole("button", { name: "Suggest swaps" }).click();
  await expect(page.getByTestId("swap-card").first()).toContainText("CO₂e/week");

  await page.getByRole("tab", { name: "Ask Vayu" }).click();
  await page.getByLabel("Your question").fill("What should I do first to protect us?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("proposal")).toBeVisible();
  await page.getByRole("button", { name: /^Apply/ }).click();
  await expect(page.getByTestId("proposal")).toHaveCount(0);

  // The plan survives a reload, because it lives in this browser.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "The Mehta family" })).toBeVisible();

  // Nothing should trip the strict CSP or log an error along the way.
  expect(consoleErrors).toEqual([]);
});

test("the form reports errors and recovers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Build my clean-air plan" }).click();
  const summary = page.getByRole("alert");
  await expect(summary).toBeFocused();
  await expect(summary).toContainText("Give your household a name");
  await summary.getByRole("link", { name: "Give your household a name" }).click();
  await expect(page.getByLabel("Household name")).toBeFocused();
});

test("the AI path shows provenance and needs approval to change anything", async ({ page }) => {
  await page.route("**/api/ai/chat", (route) =>
    route.fulfill({
      json: {
        source: "gemini",
        sanitized: false,
        cached: false,
        data: {
          reply: "Start with clean air in the bedroom tonight.",
          reasoning: "Your child is most at risk and sleeps the longest.",
          proposals: [{ type: "adoptMeasure", measureId: "measure-1", why: "Biggest win" }],
        },
      },
    }),
  );
  await createPlan(page);
  await page.getByRole("tab", { name: "Ask Vayu" }).click();
  await page.getByLabel("Your question").fill("Where do we start?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-assistant").getByTestId("ai-source")).toHaveText(
    "AI · Gemini",
  );
  await expect(page.getByText("Why:").last()).toBeVisible();

  const purifier = page
    .getByTestId("measure-card")
    .filter({ hasText: "Air purifier for the bedroom" });
  await page.getByRole("tab", { name: "Measures" }).click();
  await expect(purifier.getByLabel("Status")).toHaveValue("suggested");
  await page.getByRole("tab", { name: "Ask Vayu" }).click();
  await page.getByRole("button", { name: /^Apply/ }).click();
  await page.getByRole("tab", { name: "Measures" }).click();
  await expect(purifier.getByLabel("Status")).toHaveValue("done");
});

test("household members' names never reach the AI", async ({ page }) => {
  const bodies: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/ai/")) bodies.push(request.postData() ?? "");
  });
  await createPlan(page);
  await page.getByRole("tab", { name: "Swaps" }).click();
  await page.getByRole("button", { name: "Suggest swaps" }).click();
  await expect(page.getByTestId("swap-card").first()).toBeVisible();
  await page.getByRole("tab", { name: "Ask Vayu" }).click();
  await page.getByLabel("Your question").fill("Is today safe?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-assistant")).toBeVisible();

  expect(bodies.length).toBeGreaterThanOrEqual(3);
  for (const body of bodies) expect(body).not.toContain("Zainab");
});

test("every screen passes an axe scan, including contrast, in both themes", async ({ page }) => {
  // Fourteen full-page scans (seven screens, two themes) need more than the default.
  test.setTimeout(120_000);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expectNoAxeViolations(page);
    await createPlan(page);
    for (const tab of TABS) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel").getByRole("heading").first()).toBeAttached();
      await expectNoAxeViolations(page);
    }
    await page.evaluate(() => window.localStorage.clear());
  }
});

test("the tabs work with a keyboard", async ({ page }) => {
  await createPlan(page);
  await page.getByRole("tab", { name: "Overview" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Exposure" })).toBeFocused();
  await expect(page.getByText("Doing nothing", { exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Ask Vayu" })).toBeFocused();
});

test("the skip link appears on focus and reaches the content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});

test("the layout fits a phone with no sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto("/");
  expect(await overflow()).toBeLessThanOrEqual(0);
  await createPlan(page);
  for (const tab of TABS) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    expect(await overflow()).toBeLessThanOrEqual(0);
  }
});

test("the server sends strict security headers and refuses abuse", async ({ request }) => {
  const page = await request.get("/");
  expect(page.headers()["content-security-policy"]).toContain("default-src 'none'");
  expect(page.headers()["x-content-type-options"]).toBe("nosniff");
  expect(page.headers()["x-frame-options"]).toBe("DENY");

  const crossSite = await request.post("/api/ai/interpret", {
    headers: { origin: "https://evil.example" },
    data: { text: "we live in Delhi" },
  });
  expect(crossSite.status()).toBe(403);

  const tooBig = await request.post("/api/ai/interpret", {
    data: { text: "x".repeat(70_000) },
  });
  expect(tooBig.status()).toBe(413);
});

test("no secret or provider host reaches the browser bundle", async ({ page, request }) => {
  await page.goto("/");
  const scripts = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(".js")),
  );
  expect(scripts.length).toBeGreaterThan(0);
  for (const url of scripts) {
    const body = await (await request.get(url)).text();
    expect(body).not.toContain("generativelanguage.googleapis.com");
    expect(body).not.toContain("GEMINI_API_KEY");
  }
});
