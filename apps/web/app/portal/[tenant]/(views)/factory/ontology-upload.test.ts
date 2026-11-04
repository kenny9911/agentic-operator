import { describe, it, expect } from "vitest";
import { buildOntologyBundle, classifyAttachment, stripExt } from "./ontology-upload";

const file = (name: string, obj: unknown) => ({ name, text: JSON.stringify(obj) });

describe("buildOntologyBundle", () => {
  it("reads actions/events/rules/dataObjects from one object file", () => {
    const r = buildOntologyBundle([
      file("bundle.json", { actions: [{ name: "a" }, { name: "b" }], events: [{ name: "E" }], rules: [{ id: "r" }], dataObjects: [{ name: "O" }] }),
    ]);
    expect(r.actionCount).toBe(2);
    expect(r.eventCount).toBe(1);
    expect(r.ruleCount).toBe(1);
    expect(r.objectCount).toBe(1);
    expect(r.skipped).toEqual([]);
    expect(r.used).toEqual(["bundle.json"]);
  });

  it("honours singular/alt keys (action/event/rule/objects/entities)", () => {
    const r = buildOntologyBundle([file("x.json", { action: [{ name: "a" }], event: [{ name: "E" }], rule: [{ id: "r" }], entities: [{ name: "O" }] })]);
    expect(r.actionCount).toBe(1);
    expect(r.eventCount).toBe(1);
    expect(r.ruleCount).toBe(1);
    expect(r.objectCount).toBe(1);
  });

  it("routes a bare ARRAY file into a bucket by filename", () => {
    expect(buildOntologyBundle([file("job.events.json", [{ name: "E" }])]).eventCount).toBe(1);
    expect(buildOntologyBundle([file("policy.rules.json", [{ id: "r" }])]).ruleCount).toBe(1);
    expect(buildOntologyBundle([file("entities.json", [{ name: "O" }])]).objectCount).toBe(1);
    // no keyword in name → actions
    expect(buildOntologyBundle([file("resume.json", [{ name: "a" }])]).actionCount).toBe(1);
  });

  it("MERGES multiple split files into one bundle (the actions.json + events.json case)", () => {
    const r = buildOntologyBundle([
      file("actions.json", [{ name: "a1" }, { name: "a2" }]),
      file("events.json", [{ name: "E1" }]),
      file("rules.json", [{ id: "r1" }]),
    ]);
    expect(r.actionCount).toBe(2);
    expect(r.eventCount).toBe(1);
    expect(r.ruleCount).toBe(1);
    expect(r.used).toHaveLength(3);
  });

  it("preserves artifact buckets when split-file prefixes mention workflows, agents or links", () => {
    const files = [
      file("linked-actions.json", [{ name: "linkPurchase" }]),
      file("workflow.events.json", [{ name: "PurchaseLinked" }]),
      file("agent.objects.json", [{ name: "Purchase" }]),
    ];
    expect(files.every(({ name, text }) => classifyAttachment(name, text) === "ontology")).toBe(true);
    const { bundle } = buildOntologyBundle(files);
    expect(bundle).toEqual({
      actions: [{ name: "linkPurchase" }], events: [{ name: "PurchaseLinked" }],
      dataObjects: [{ name: "Purchase" }], rules: [],
    });
  });

  it("uses the final explicit artifact name for graph and workflow exports too", () => {
    const { bundle } = buildOntologyBundle([
      file("purchase.actions.links_v0_4_000.json", [{ from: "a", to: "E" }]),
      file("purchase.events.workflows.json", [{ name: "purchase" }]),
      file("agent.events_v0_4_000.json", []),
    ]);
    expect(bundle).toEqual({
      actions: [], events: [], rules: [], dataObjects: [],
      links: [{ from: "a", to: "E" }], workflow: [{ name: "purchase" }],
    });
  });

  it("keeps legacy artifact precedence for export names without separators", () => {
    const { bundle } = buildOntologyBundle([
      file("workflowEvents.json", [{ name: "E" }]),
      file("agentObjects.json", [{ name: "O" }]),
      file("linkedActions.json", [{ name: "a" }]),
    ]);
    expect(bundle).toEqual({ actions: [{ name: "a" }], events: [{ name: "E" }], rules: [], dataObjects: [{ name: "O" }] });
  });

  it("preserves supplied link graphs and workflow rows without flattening their fields", () => {
    const links = [{ id: "approved-link", from: "a", to: "E", metadata: { approved: true } }];
    const workflow = [{ name: "purchase", stages: [{ id: "review" }] }];
    const { bundle } = buildOntologyBundle([file("bundle.json", { actions: [{ name: "a" }], links, workflow })]);
    expect(bundle.links).toEqual(links);
    expect(bundle.workflow).toEqual(workflow);
  });

  it("distinguishes omitted optional fields from explicitly empty arrays, including split files", () => {
    const source = file("actions.json", [{ name: "a" }]);
    const absent = buildOntologyBundle([source]).bundle;
    expect(absent).not.toHaveProperty("links");
    expect(absent).not.toHaveProperty("workflow");
    const explicit = buildOntologyBundle([source, file("links.json", []), file("workflows.json", [])]).bundle;
    expect(explicit.links).toEqual([]);
    expect(explicit.workflow).toEqual([]);
    expect(explicit.actions).toEqual([{ name: "a" }]);
    const aliases = buildOntologyBundle([source, file("empty.json", { link: [], agents: [] })]).bundle;
    expect(aliases.links).toEqual([]);
    expect(aliases.workflow).toEqual([]);
  });

  it("recognizes backend aliases and payload arrays, with canonical empty values taking precedence", () => {
    const { bundle } = buildOntologyBundle([file("bundle.json", {
      actions: { payload: [{ name: "a" }] }, object: [{ name: "Purchase" }],
      link: { payload: [{ from: "a", to: "Purchase" }] }, agents: { payload: [{ name: "purchaseAgent" }] },
    })]);
    expect(bundle.actions).toEqual([{ name: "a" }]);
    expect(bundle.dataObjects).toEqual([{ name: "Purchase" }]);
    expect(bundle.links).toEqual([{ from: "a", to: "Purchase" }]);
    expect(bundle.workflow).toEqual([{ name: "purchaseAgent" }]);
    const empty = buildOntologyBundle([file("x.json", { links: [], link: [{ id: "ignored" }], workflow: [], agents: [{ id: "ignored" }] })]).bundle;
    expect(empty.links).toEqual([]);
    expect(empty.workflow).toEqual([]);
  });

  it("routes and merges bare link/workflow/agent arrays without treating them as actions", () => {
    const { bundle } = buildOntologyBundle([
      file("actions.json", [{ name: "a" }]), file("links.json", [{ from: "a", to: "E" }]),
      file("workflow.json", [{ name: "first" }]), file("agents.json", [{ name: "second" }]),
    ]);
    expect(bundle.actions).toEqual([{ name: "a" }]);
    expect(bundle.links).toEqual([{ from: "a", to: "E" }]);
    expect(bundle.workflow).toEqual([{ name: "first" }, { name: "second" }]);
  });

  it("collects non-JSON files into skipped (never silently dropped)", () => {
    const r = buildOntologyBundle([
      { name: "good.json", text: JSON.stringify({ actions: [{ name: "a" }] }) },
      { name: "broken.json", text: "{ not json ," },
      { name: "notes.txt", text: "hello world" },
    ]);
    expect(r.actionCount).toBe(1);
    expect(r.skipped).toEqual(["broken.json", "notes.txt"]);
    expect(r.used).toEqual(["good.json"]);
  });

  it("returns zero actions for an empty/no-action upload (caller rejects → backend would too)", () => {
    expect(buildOntologyBundle([file("empty.json", { events: [{ name: "E" }] })]).actionCount).toBe(0);
    expect(buildOntologyBundle([]).actionCount).toBe(0);
  });
});

describe("classifyAttachment", () => {
  it("classifies an ontology-shaped object as ontology", () => {
    expect(classifyAttachment("x.json", JSON.stringify({ actions: [{ name: "a" }] }))).toBe("ontology");
    expect(classifyAttachment("x.json", JSON.stringify({ events: [] }))).toBe("ontology");
  });

  it("classifies an action-like array as ontology", () => {
    expect(classifyAttachment("acts.json", JSON.stringify([{ trigger: ["E"], name: "a" }]))).toBe("ontology");
    // array of objects whose FILENAME implies ontology
    expect(classifyAttachment("my-actions.json", JSON.stringify([{ name: "a" }]))).toBe("ontology");
    // bare actions array with a GENERIC filename + no action-signal fields (regression: this must
    // still be ontology so 📎 can create a domain — the old modal supported it).
    expect(classifyAttachment("list.json", JSON.stringify([{ name: "createJob" }, { name: "closeJob" }]))).toBe("ontology");
    expect(classifyAttachment("x.json", JSON.stringify([{ id: "a1" }]))).toBe("ontology");
  });

  it("recognizes optional ontology fields and named arrays, including explicit empty graph exports", () => {
    for (const value of [{ links: [] }, { link: [] }, { workflow: [] }, { workflows: [] }, { agents: [] }, { object: [] }]) {
      expect(classifyAttachment("part.json", JSON.stringify(value))).toBe("ontology");
    }
    for (const name of ["links.json", "link.json", "workflow.json", "workflows.json", "agents.json"]) {
      expect(classifyAttachment(name, "[]")).toBe("ontology");
    }
    expect(classifyAttachment("links.json", JSON.stringify([{ from: "a", to: "E" }]))).toBe("ontology");
    expect(classifyAttachment("links.json", "[1, 2]")).toBe("tooldoc");
  });

  it("classifies OpenAPI / prose / non-ontology JSON as tooldoc", () => {
    expect(classifyAttachment("api.json", JSON.stringify({ openapi: "3.0", paths: {} }))).toBe("tooldoc");
    expect(classifyAttachment("readme.md", "# How to use the CRM API\ncall POST /candidates")).toBe("tooldoc");
    expect(classifyAttachment("data.json", JSON.stringify([1, 2, 3]))).toBe("tooldoc");
    // an array of records with NO name/id and NO signal fields stays a tool/data doc
    expect(classifyAttachment("rows.json", JSON.stringify([{ foo: 1 }, { bar: 2 }]))).toBe("tooldoc");
  });
});

describe("stripExt", () => {
  it("drops a single trailing extension", () => {
    expect(stripExt("招聘本体.json")).toBe("招聘本体");
    expect(stripExt("a.b.json")).toBe("a.b");
    expect(stripExt("noext")).toBe("noext");
  });
});
