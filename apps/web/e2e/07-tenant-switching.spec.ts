import { expect, test } from "@playwright/test";

test.describe("tenant switching", () => {
  test("refreshes tenant data and restores the last opened tenant", async ({
    page,
  }) => {
    const scopedRequests: string[] = [];
    page.on("request", (request) => {
      if (!request.url().includes("/v1/")) return;
      const tenant = request.headers()["x-agentic-tenant"];
      if (tenant) scopedRequests.push(tenant);
    });

    await page.goto("/portal/raas/dashboard", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator('button[aria-haspopup="listbox"]')).toBeVisible();
    await page.evaluate(() => {
      (window as Window & { __tenantDocument?: string }).__tenantDocument =
        "raas";
    });

    await page.getByRole("button", { name: "Keep navigation open" }).click();
    await page.locator('button[aria-haspopup="listbox"]').click();
    await page.getByRole("option").filter({ hasText: "SupportFlow" }).click();

    await page.waitForURL(/\/portal\/support\/dashboard$/);
    await expect.poll(() => scopedRequests.includes("support")).toBe(true);
    await expect(
      page.locator('button[aria-haspopup="listbox"]'),
    ).toHaveAttribute("aria-label", /SupportFlow tenant/);

    // A full document navigation is intentional: no RAAS component state or
    // TanStack Query cache can survive into the selected tenant.
    const oldDocumentMarker = await page.evaluate(
      () => (window as Window & { __tenantDocument?: string }).__tenantDocument,
    );
    expect(oldDocumentMarker).toBeUndefined();

    // The cookie-backed preference, rather than a hard-coded RAAS fallback,
    // drives subsequent bare portal visits.
    await page.goto("/portal", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/portal\/support\/dashboard$/);

    const denied = await page.request.post("/api/prefs", {
      data: { tenant: "does-not-exist" },
    });
    expect(denied.status()).toBe(404);
    await page.goto("/portal", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/portal\/support\/dashboard$/);

    // A newly issued session also inherits the remembered tenant instead of
    // silently resetting to RAAS when the login request omits a tenant.
    const logout = await page.request.post("/api/auth/logout");
    expect(logout.status()).toBe(200);
    const login = await page.request.post("/api/auth/login", {
      data: { email: "operator@example.test", name: "Portal Operator" },
    });
    expect(login.status()).toBe(200);
    await expect(login.json()).resolves.toMatchObject({
      ok: true,
      data: { tenant: "support" },
    });
    await page.goto("/portal", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/portal\/support\/dashboard$/);
  });

  test("rejects an unavailable tenant deep link without remembering it", async ({
    page,
  }) => {
    await page.goto("/portal/does-not-exist/dashboard", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(/\/portal\/raas\/dashboard$/);

    await page.goto("/portal", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/portal\/raas\/dashboard$/);
  });

  test("keeps other open portal tabs in the selected tenant", async ({
    context,
    page,
  }) => {
    const otherPage = await context.newPage();

    await Promise.all([
      page.goto("/portal/raas/dashboard", {
        waitUntil: "domcontentloaded",
      }),
      otherPage.goto("/portal/raas/dashboard", {
        waitUntil: "domcontentloaded",
      }),
    ]);
    await Promise.all([
      expect(page.locator('button[aria-haspopup="listbox"]')).toBeVisible(),
      expect(
        otherPage.locator('button[aria-haspopup="listbox"]'),
      ).toBeVisible(),
    ]);
    await otherPage.evaluate(() => {
      (window as Window & { __tenantDocument?: string }).__tenantDocument =
        "raas";
    });

    await page.getByRole("button", { name: "Keep navigation open" }).click();
    await page.locator('button[aria-haspopup="listbox"]').click();
    await page.getByRole("option").filter({ hasText: "SupportFlow" }).click();

    await Promise.all([
      page.waitForURL(/\/portal\/support\/dashboard$/),
      otherPage.waitForURL(/\/portal\/support\/dashboard$/),
    ]);
    await expect(
      otherPage.locator('button[aria-haspopup="listbox"]'),
    ).toHaveAttribute("aria-label", /SupportFlow tenant/);
    expect(
      await otherPage.evaluate(
        () =>
          (window as Window & { __tenantDocument?: string }).__tenantDocument,
      ),
    ).toBeUndefined();
  });
});
