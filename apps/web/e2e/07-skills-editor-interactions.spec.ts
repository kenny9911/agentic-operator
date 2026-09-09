import { test, expect, type Page } from "@playwright/test";
import {
  SKILL_BUNDLE_LIMITS,
  type SkillBundle,
  type SkillDetail,
} from "@agentic/contracts";

// These interaction tests never write to the live library or call a model.
const instructions =
  "---\nname: interaction-test\ndescription: Check editor interactions\n---\n\n# Instructions\n";
const initialBundle: SkillBundle = {
  files: [
    { path: "SKILL.md", encoding: "utf8", content: instructions },
    { path: "assets/logo.bin", encoding: "base64", content: "AP8=" },
  ],
};
const initialDetail: SkillDetail = {
  skill: {
    id: "skl-interactions",
    tenantId: "tnt-test",
    name: "interaction-test",
    description: "Check editor interactions",
    visibility: "tenant",
    latestVersionId: null,
    latestVersionNo: null,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    canEdit: true,
    draftRevision: 1,
  },
  draft: {
    revision: 1,
    bundle: initialBundle,
    diagnostics: [],
    creatorNotes: null,
    provenance: null,
    updatedAt: 1,
    updatedBy: null,
  },
  latestVersion: null,
  versions: [],
};

async function prepare(page: Page) {
  const saves: SkillBundle[] = [];
  let detail = structuredClone(initialDetail);
  await page.addInitScript(() => {
    localStorage.setItem("agentic.tweaks", JSON.stringify({ language: "en" }));
    const arrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === "slow.bin") {
        await new Promise<void>((resolve) => {
          (
            window as Window & { releaseSkillRead?: () => void }
          ).releaseSkillRead = resolve;
        });
      }
      return arrayBuffer.call(this);
    };
  });
  await page.route("**/v1/me", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          user: {
            id: "usr-interactions",
            email: "interactions@example.test",
            name: "Interaction reviewer",
            platformRole: "superadmin",
            status: "active",
            createdAt: 1,
          },
          activeTenant: { slug: "raas", name: "RAAS", role: "admin" },
          memberships: [
            { tenantSlug: "raas", tenantName: "RAAS", role: "admin" },
          ],
          capabilities: ["skills.read", "skills.write", "skills.publish"],
        },
      },
    }),
  );
  await page.route("**/v1/skills{,/**,?*}", async (route) => {
    const url = new URL(route.request().url());
    const request = route.request();
    let data: unknown;
    if (url.pathname.endsWith("/import/preview")) {
      data = { valid: true, diagnostics: [], bundle: initialBundle };
    } else if (url.pathname.endsWith("/validate")) {
      data = { valid: true, diagnostics: [] };
    } else if (url.pathname.endsWith("/draft") && request.method() === "PUT") {
      const body = request.postDataJSON() as { bundle: SkillBundle };
      saves.push(body.bundle);
      detail = {
        ...detail,
        draft: {
          ...detail.draft!,
          bundle: body.bundle,
          revision: detail.draft!.revision + 1,
        },
      };
      data = detail;
    } else if (url.pathname.endsWith("/evaluations")) {
      data = { evaluations: [], nextOffset: null };
    } else if (url.pathname.endsWith("/skl-interactions")) {
      data = detail;
    } else if (url.pathname === "/v1/skills") {
      data = { skills: [detail.skill], nextOffset: null };
    } else {
      await route.fulfill({
        status: 400,
        json: {
          ok: false,
          error: { code: "unexpected_test_request", message: url.pathname },
        },
      });
      return;
    }
    await route.fulfill({ json: { ok: true, data } });
  });
  await page.route("**/v1/llm/settings", (route) =>
    route.fulfill({
      json: { ok: true, data: { settings: { gatewayInstances: [] } } },
    }),
  );
  if (process.env.PW_SKILLS_DEV_AUTH === "1") {
    // Only the explicit local dev-auth verification stack accepts this cookie.
    await page.context().addCookies([
      {
        name: "agentic_session",
        value: "local-dev-verification",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  } else {
    const { loginBootstrapAdmin } = await import("./helpers");
    await loginBootstrapAdmin(page, "/portal/raas/skills");
  }
  return saves;
}

async function releaseRead(page: Page) {
  await page.evaluate(() => {
    const release = (window as Window & { releaseSkillRead?: () => void })
      .releaseSkillRead;
    if (!release) throw new Error("No delayed file read started");
    release();
  });
}

test("a long skill catalog scrolls to later pages without mixing tenant and shared libraries", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await prepare(page);
  const sharedSkills: SkillDetail["skill"][] = Array.from(
    { length: 53 },
    (_, index) => {
      const number = String(index + 1).padStart(3, "0");
      return {
        ...initialDetail.skill,
        id: `skl-long-catalog-${number}`,
        tenantId: "tnt-system",
        name: `catalog-skill-${number}`,
        description: `Published shared guidance ${number} for agents and workflows.`,
        visibility: "shared",
        latestVersionId: `skv-long-catalog-${number}`,
        latestVersionNo: 1,
        canEdit: false,
        draftRevision: null,
      };
    },
  );
  const tenantSkill: SkillDetail["skill"] = {
    ...initialDetail.skill,
    id: "skl-tenant-only",
    name: "tenant-only-review",
    description: "Private RAAS guidance retained alongside the shared catalog.",
  };
  const requests: Array<{
    scope: string;
    offset: number;
    tenant: string | undefined;
  }> = [];
  await page.route("**/v1/skills?*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const scope = url.searchParams.get("scope") ?? "available";
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    requests.push({
      scope,
      offset,
      tenant: request.headers()["x-agentic-tenant"],
    });
    const skills =
      scope === "owned"
        ? [tenantSkill]
        : scope === "shared"
          ? sharedSkills
          : [...sharedSkills, tenantSkill];
    await route.fulfill({
      json: {
        ok: true,
        data: {
          skills: skills.slice(offset, offset + limit),
          nextOffset: offset + limit < skills.length ? offset + limit : null,
        },
      },
    });
  });
  await page.goto("/portal/raas/skills");
  const sharedRows = page.locator(
    'a[href^="/portal/raas/skills/skl-long-catalog-"]',
  );
  const tenantRow = page.locator(
    'a[href="/portal/raas/skills/skl-tenant-only"]',
  );
  const loadMore = page.getByRole("button", { name: "Load more", exact: true });
  await expect(sharedRows).toHaveCount(50);
  await expect(sharedRows.first()).toBeInViewport();
  await expect(sharedRows.last()).not.toBeInViewport();
  await expect(loadMore).not.toBeInViewport();

  // Exercise the user's wheel gesture. Clicking or scrollIntoViewIfNeeded
  // would force programmatic scrolling and could conceal a clipped viewport.
  await sharedRows.first().hover();
  await page.mouse.wheel(0, 12_000);
  await expect(loadMore).toBeInViewport({ ratio: 0.9 });
  await loadMore.click();
  await expect(sharedRows).toHaveCount(53);
  await expect(tenantRow).toHaveCount(1);
  await expect(loadMore).toHaveCount(0);
  await page.mouse.wheel(0, 12_000);
  await expect(tenantRow).toBeInViewport({ ratio: 0.9 });
  await expect(sharedRows.last()).toContainText("catalog-skill-053");
  expect(requests).toContainEqual({ scope: "available", offset: 50, tenant: "raas" });

  await page.getByRole("button", { name: "This tenant", exact: true }).click();
  await expect(sharedRows).toHaveCount(0);
  await expect(tenantRow).toHaveCount(1);
  await expect(tenantRow).toBeInViewport();
  await expect(loadMore).toHaveCount(0);

  await page.getByRole("button", { name: "Shared library", exact: true }).click();
  await expect(sharedRows).toHaveCount(50);
  await expect(tenantRow).toHaveCount(0);
  await sharedRows.first().hover();
  await page.mouse.wheel(0, 12_000);
  await expect(loadMore).toBeInViewport({ ratio: 0.9 });
  await loadMore.click();
  await expect(sharedRows).toHaveCount(53);
  await expect(tenantRow).toHaveCount(0);
  await expect(loadMore).toHaveCount(0);
  const loadedPageRequests = () =>
    requests.filter((request) => request.scope === "shared" && request.offset === 50).length;
  const beforeRefresh = loadedPageRequests();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(loadedPageRequests).toBeGreaterThan(beforeRefresh);
  await expect(sharedRows).toHaveCount(53);
  await expect(tenantRow).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Shared library", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(requests).toContainEqual({ scope: "owned", offset: 0, tenant: "raas" });
  expect(requests).toContainEqual({ scope: "shared", offset: 50, tenant: "raas" });
  expect(requests.every((request) => request.tenant === "raas")).toBe(true);
});

test("Escape and Tab stay inside the inner file dialog without discarding an import", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/portal/raas/skills");
  await page.getByRole("button", { name: "Import skill", exact: true }).click();
  await page.locator('input[type="file"][accept]').setInputFiles({
    name: "SKILL.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(instructions),
  });
  await page
    .getByRole("button", { name: "Add text file", exact: true })
    .click();
  const inner = page.getByRole("dialog", {
    name: "Add text file",
    exact: true,
  });
  const path = inner.getByRole("textbox", { name: "Relative file path" });
  await path.fill("references/unfinished.md");
  await inner.getByRole("button", { name: "Add file", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(path).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    inner.getByRole("button", { name: "Add file", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(inner).toHaveCount(0);
  const parent = page.getByRole("dialog", {
    name: "Import skill",
    exact: true,
  });
  await expect(parent).toBeVisible();
  await expect(
    parent.getByRole("button", { name: "Add text file", exact: true }),
  ).toBeFocused();
  await expect(
    parent.getByRole("button", { name: /assets\/logo.bin/ }),
  ).toBeVisible();
});

test("a delayed upload gates saving and merges file edits made while reading", async ({
  page,
}) => {
  const saves = await prepare(page);
  await page.goto("/portal/raas/skills/skl-interactions");
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: "slow.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0, 254]),
  });
  await expect(
    page.getByText("Reading selected files…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Validate", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Add text file", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add text file",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Relative file path" })
    .fill("references/during-read.md");
  await dialog.getByRole("button", { name: "Add file", exact: true }).click();
  await releaseRead(page);
  await expect(
    page.getByText("Reading selected files…", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /references\/during-read.md/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /slow.bin/ })).toBeVisible();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]!.files.map((file) => file.path).sort()).toEqual([
    "SKILL.md",
    "assets/logo.bin",
    "references/during-read.md",
    "slow.bin",
  ]);
  expect(
    saves[0]!.files.find((file) => file.path === "slow.bin"),
  ).toMatchObject({ encoding: "base64", content: "AP4=" });
});

test("a delayed replacement cannot revive a resource removed while reading", async ({
  page,
}) => {
  const saves = await prepare(page);
  await page.goto("/portal/raas/skills/skl-interactions");
  await page.getByRole("button", { name: /assets\/logo.bin/ }).click();
  await page.locator('input[type="file"]:not([multiple])').setInputFiles({
    name: "slow.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0, 254]),
  });
  await page.getByRole("button", { name: "Remove file", exact: true }).click();
  await releaseRead(page);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "A file or folder already uses this path" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /assets\/logo.bin/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]!.files.map((file) => file.path)).toEqual(["SKILL.md"]);
});

test("model discovery cannot submit the tenant default after a gateway was selected", async ({
  page,
}) => {
  await prepare(page);
  let completeDiscovery!: () => void;
  const discovery = new Promise<void>((resolve) => {
    completeDiscovery = resolve;
  });
  const generatedRoutes: unknown[] = [];
  await page.route("**/v1/llm/settings", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          settings: {
            gatewayInstances: [
              {
                id: "test-gateway",
                displayName: "Selected gateway",
                enabled: true,
                kind: "direct",
                providerId: "openai",
              },
            ],
          },
        },
      },
    }),
  );
  await page.route("**/v1/llm/gateways/test-gateway/models", async (route) => {
    await discovery;
    await route.fulfill({
      json: {
        ok: true,
        data: {
          gatewayInstanceId: "test-gateway",
          source: "live",
          models: [{ id: "chosen-model" }],
          message: null,
        },
      },
    });
  });
  await page.route("**/v1/skills/generate", async (route) => {
    generatedRoutes.push(route.request().postDataJSON().modelRoute);
    await route.fulfill({
      status: 503,
      json: {
        ok: false,
        error: {
          code: "fixture_stopped",
          message: "No model call is made by this test.",
        },
      },
    });
  });
  await page.goto("/portal/raas/skills");
  await page
    .getByRole("button", { name: "Describe a skill", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Describe a skill",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "What should this skill help agents do?" })
    .fill("Review test purchase orders and cite missing approvals.");
  await dialog
    .getByRole("combobox", { name: "Model route", exact: true })
    .selectOption("test-gateway");
  const model = dialog.getByRole("combobox", {
    name: "Choose a model",
    exact: true,
  });
  await expect(model).toHaveAttribute("aria-busy", "true");
  await expect(model).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Create skill", exact: true })
    .click();
  expect(
    await model.evaluate(
      (element: HTMLSelectElement) => element.validity.valueMissing,
    ),
  ).toBe(true);
  expect(generatedRoutes).toEqual([]);
  completeDiscovery();
  await model.selectOption("chosen-model");
  await dialog
    .getByRole("button", { name: "Create skill", exact: true })
    .click();
  await expect
    .poll(() => generatedRoutes)
    .toEqual(["test-gateway/chosen-model"]);
});

test("accepting an AI revision updates Monaco without manufacturing unsaved edits or dropping resources", async ({
  page,
}) => {
  const saves = await prepare(page);
  const revisedBundle: SkillBundle = {
    files: [
      {
        path: "SKILL.md",
        encoding: "utf8",
        content: instructions + "\nUpdated instructions from the revision.\n",
      },
      initialBundle.files[1]!,
      {
        path: "references/generated.md",
        encoding: "utf8",
        content: "Keep this generated resource.",
      },
    ],
  };
  const provenance = {
    mode: "ai-assisted",
    tenantId: "tnt-test",
    actorType: "user",
    actorId: "usr-interactions",
    requestedRoute: null,
    creatorPolicyDigest: "a".repeat(64),
    creatorPolicyVersion: null,
    requestDigest: "b".repeat(64),
    baseFingerprint: "c".repeat(64),
    outputDigest: "d".repeat(64),
    generatedAt: "2026-09-09T00:00:00.000Z",
    attempts: [
      {
        taskType: "agent.author",
        provider: "deepseek",
        model: "test-only",
        tokensIn: 1,
        tokensOut: 1,
        finishReason: "stop",
        latencyMs: 1,
      },
    ],
    tokensIn: 1,
    tokensOut: 1,
  };
  await page.route("**/v1/skills/skl-interactions/generate", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          detail: {
            ...initialDetail,
            skill: { ...initialDetail.skill, draftRevision: 2 },
            draft: {
              ...initialDetail.draft!,
              revision: 2,
              bundle: revisedBundle,
              provenance,
            },
          },
          generation: {
            bundle: revisedBundle,
            diagnostics: [],
            assumptions: [],
            suggestedTests: [],
            changeSummary: ["Updated instructions."],
            provenance,
          },
        },
      },
    }),
  );
  await page.goto("/portal/raas/skills/skl-interactions");
  // Keep the existing Monaco model mounted before the server replaces its text.
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "Instructions",
  );
  await page
    .getByRole("button", { name: "Revise with AI", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Revise with AI",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "What should this skill help agents do?" })
    .fill("Update the instructions and include a reference file.");
  await dialog
    .getByRole("button", { name: "Generate revision", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "Updated instructions from the revision.",
  );
  await expect(
    page.locator("span").filter({ hasText: /^Draft revision 2$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Publish version", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /references\/generated.md/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /assets\/logo.bin/ }),
  ).toBeVisible();
  // A subsequent real keystroke must still be treated as an edit and keep both resources.
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\nHuman edit after revision.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(
    saves[0]!.files.find((file) => file.path === "SKILL.md")?.content,
  ).toContain("Human edit after revision.");
  expect(
    saves[0]!.files.find((file) => file.path === "assets/logo.bin"),
  ).toEqual(initialBundle.files[1]);
  expect(
    saves[0]!.files.find((file) => file.path === "references/generated.md"),
  ).toEqual(revisedBundle.files[2]);
});

test("an oversized paste restores the last accepted editor text before saving", async ({
  page,
}) => {
  const saves = await prepare(page);
  await page.goto("/portal/raas/skills/skl-interactions");
  const editor = page.locator(".monaco-editor .view-lines");
  await expect(editor).toContainText("Instructions");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\nAccepted edit before paste.\n");
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+A");
  await page.evaluate(
    (content) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", content);
      document.activeElement!.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    "Rejected paste marker\n" + "x".repeat(SKILL_BUNDLE_LIMITS.maxSkillMdBytes),
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "The bundle exceeds its file count or size limit." }),
  ).toBeVisible();
  await expect(editor).toContainText("Accepted edit before paste.");
  await expect(editor).not.toContainText("Rejected paste marker");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  const saved = saves[0]!.files.find(
    (file) => file.path === "SKILL.md",
  )!.content;
  expect(saved).toContain("Accepted edit before paste.");
  expect(saved).not.toContain("Rejected paste marker");
  expect(
    saves[0]!.files.find((file) => file.path === "assets/logo.bin"),
  ).toEqual(initialBundle.files[1]);
});
