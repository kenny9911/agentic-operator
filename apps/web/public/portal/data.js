// Agentic Operator — SPA data bootstrap
//
// Replaces the hard-coded mock data from the standalone prototype with a
// fetch against /api/spa/bootstrap. The endpoint serves agents/events from
// models/RAAS-v1/*.json (source=json) or Neo4j (source=neo4j, stubbed).
//
// The SPA waits on `window.RAAS_BOOTSTRAP` (a Promise) before rendering, so
// every view sees populated `window.RAAS_*` globals.

(function () {
  // Empty defaults so anything that reads these before the fetch resolves
  // sees a valid shape rather than `undefined`.
  window.RAAS_AGENTS = [];
  window.RAAS_EVENTS = [];
  window.RAAS_STAGES = [];
  window.RAAS_REQS = [];
  window.RAAS_CANDIDATES = [];
  window.RAAS_RUNS = [];
  window.RAAS_EVENT_STREAM = [];
  window.RAAS_TASKS = [];
  window.RAAS_SAMPLE_LOG = "";
  window.RAAS_DEPLOYMENTS = [];
  window.TENANTS = [
    {
      id: "raas",
      name: "RAAS",
      subtitle: "Loading…",
      color: "#d0ff00",
      active: true,
      agentCount: 0,
      runs24h: 0,
    },
  ];
  window.RAAS_DATA_SOURCE = "json";
  window.RAAS_BOOTSTRAP_ERROR = null;

  // Settings-owned model fleet. Lives on window so it survives view switches
  // and is readable from anywhere that doesn't get the React prop. The
  // canonical runtime value is the [models, setModels] state in App, which
  // mirrors back to this global on every change.
  window.RAAS_SETTINGS_MODELS = [
    { id: "m1", name: "claude-sonnet-4-5", provider: "Anthropic", usedBy: 9, cap: "$60/day", spent: 41.20, status: "primary" },
    { id: "m2", name: "claude-haiku-4-5",  provider: "Anthropic", usedBy: 4, cap: "$15/day", spent: 6.83,  status: "primary" },
    { id: "m3", name: "gpt-4.1-mini",      provider: "OpenAI",    usedBy: 0, cap: "$5/day",  spent: 0.00,  status: "fallback" },
  ];

  function applyPayload(payload) {
    window.RAAS_AGENTS = payload.agents || [];
    window.RAAS_EVENTS = payload.events || [];
    window.RAAS_STAGES = payload.stages || [];
    window.RAAS_REQS = payload.reqs || [];
    window.RAAS_CANDIDATES = payload.candidates || [];
    window.RAAS_RUNS = payload.runs || [];
    window.RAAS_EVENT_STREAM = payload.eventStream || [];
    window.RAAS_TASKS = payload.tasks || [];
    window.RAAS_SAMPLE_LOG = payload.sampleLog || "";
    window.RAAS_DEPLOYMENTS = payload.deployments || [];
    window.TENANTS = payload.tenants || window.TENANTS;
    window.RAAS_DATA_SOURCE = payload.source || "json";
    window.RAAS_BOOTSTRAP_LOADED_AT = payload.loadedAt;
  }

  function fetchBootstrap(source) {
    var src = source || "json";
    return fetch("/api/spa/bootstrap?source=" + encodeURIComponent(src), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || (body && body.ok === false)) {
          var msg =
            (body && body.error && body.error.message) ||
            "Bootstrap failed (" + res.status + ")";
          var e = new Error(msg);
          e.status = res.status;
          throw e;
        }
        return body;
      });
    });
  }

  // Allow runtime swapping. Settings view / tweaks panel can call this to
  // re-fetch with a different source.
  window.RAAS_RELOAD = function (source) {
    window.RAAS_BOOTSTRAP_ERROR = null;
    var promise = fetchBootstrap(source).then(function (payload) {
      applyPayload(payload);
      window.dispatchEvent(
        new CustomEvent("raas-data-loaded", { detail: payload }),
      );
      return payload;
    });
    promise.catch(function (err) {
      window.RAAS_BOOTSTRAP_ERROR = err.message || String(err);
      window.dispatchEvent(
        new CustomEvent("raas-data-error", { detail: err.message }),
      );
    });
    window.RAAS_BOOTSTRAP = promise;
    return promise;
  };

  window.RAAS_BOOTSTRAP = fetchBootstrap("json")
    .then(function (payload) {
      applyPayload(payload);
      console.log(
        "[Agentic Operator] RAAS data loaded:",
        window.RAAS_AGENTS.length,
        "agents,",
        window.RAAS_EVENTS.length,
        "event types,",
        window.RAAS_RUNS.length,
        "runs,",
        window.RAAS_EVENT_STREAM.length,
        "events,",
        window.RAAS_TASKS.length,
        "tasks · source=" + window.RAAS_DATA_SOURCE,
      );
      window.dispatchEvent(
        new CustomEvent("raas-data-loaded", { detail: payload }),
      );
      return payload;
    })
    .catch(function (err) {
      window.RAAS_BOOTSTRAP_ERROR = err.message || String(err);
      console.error("[Agentic Operator] bootstrap failed:", err);
      window.dispatchEvent(
        new CustomEvent("raas-data-error", { detail: err.message }),
      );
      throw err;
    });
})();

// ─── window.testAgent ────────────────────────────────────────────────────────
// Trigger a synthetic run for an agent. Creates a "running" run, advances each
// step on a timer (mimicking step-engine behavior), emits the agent's first
// `emits` event onto the stream when done. Views listen for `raas-runs-updated`
// and `raas-events-updated` to re-render.
//
// Usage:
//   const run = window.testAgent(agent);
//   navigate("runs", { runId: run.id });
//
// opts.subject overrides the auto-picked REQ/CAN id.
// opts.fail forces the final step to fail (for testing error paths).
(function () {
  function dispatchRunsUpdated(run) {
    window.dispatchEvent(new CustomEvent("raas-runs-updated", { detail: run }));
  }
  function dispatchEventsUpdated(evt) {
    window.dispatchEvent(new CustomEvent("raas-events-updated", { detail: evt }));
  }

  function pickSubject(agent, opts) {
    if (opts && opts.subject) return opts.subject;
    const reqs = window.RAAS_REQS || [];
    const cands = window.RAAS_CANDIDATES || [];
    const useReq = (agent.stage == null ? 0 : agent.stage) <= 3;
    if (useReq && reqs.length > 0) return reqs[0].id;
    if (!useReq && cands.length > 0) return cands[0].id;
    if (reqs.length > 0) return reqs[0].id;
    if (cands.length > 0) return cands[0].id;
    return "TEST-SUBJECT";
  }

  function makeRunId() {
    return "run-test-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function pushEvent(name, agent, subject, endedAt) {
    if (!name) return;
    const evDef = (window.RAAS_EVENTS || []).find(function (e) { return e.name === name; });
    const downstream = (window.RAAS_AGENTS || [])
      .filter(function (a) { return (a.triggers || []).includes(name); })
      .map(function (a) { return a.id; });
    const evt = {
      id: "evt-test-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: name,
      category: evDef ? evDef.category : "agent",
      color: evDef ? evDef.color : "green",
      at: endedAt,
      source: agent.id,
      sourceTitle: agent.title,
      downstream: downstream,
      subject: subject,
      payloadBytes: 200 + Math.floor(Math.random() * 2000),
      testRun: true,
    };
    window.RAAS_EVENT_STREAM = [evt].concat(window.RAAS_EVENT_STREAM || []);
    dispatchEventsUpdated(evt);
  }

  window.testAgent = function (agent, opts) {
    opts = opts || {};
    if (!agent) {
      console.warn("[testAgent] no agent provided");
      return null;
    }
    const now = Date.now();
    const subject = pickSubject(agent, opts);
    const stepNames = (agent.steps && agent.steps.length > 0) ? agent.steps : ["execute"];
    const steps = stepNames.map(function (name, i) {
      return {
        name: name,
        status: i === 0 ? "running" : "pending",
        startedAt: i === 0 ? now : null,
        durationMs: null,
      };
    });

    const run = {
      id: makeRunId(),
      agentId: agent.id,
      agentName: agent.name,
      agentTitle: agent.title,
      actor: agent.actor || "Agent",
      status: agent.actor === "Human" ? "waiting" : "running",
      startedAt: now,
      endedAt: null,
      durationMs: 0,
      triggerEvent: (agent.triggers && agent.triggers[0]) || "MANUAL_TEST",
      subject: subject,
      steps: steps,
      tokensIn: 0,
      tokensOut: 0,
      model: agent.model,
      emittedEvent: null,
      testRun: true,
    };

    window.RAAS_RUNS = [run].concat(window.RAAS_RUNS || []);
    dispatchRunsUpdated(run);

    // Human-actor agents: pause as waiting; the user resolves via the Tasks view.
    if (run.actor === "Human") return run;

    function advance(idx) {
      const delay = 600 + Math.floor(Math.random() * 1400);
      setTimeout(function () {
        const cur = (window.RAAS_RUNS || []).find(function (r) { return r.id === run.id; });
        if (!cur) return;
        const step = cur.steps[idx];
        if (!step) return;

        const isLast = idx >= cur.steps.length - 1;
        const fail = !!opts.fail && isLast;
        step.status = fail ? "failed" : "ok";
        step.durationMs = delay;
        cur.tokensIn += 500 + Math.floor(Math.random() * 1800);
        cur.tokensOut += 100 + Math.floor(Math.random() * 600);
        cur.durationMs = Date.now() - cur.startedAt;

        if (!isLast) {
          const next = cur.steps[idx + 1];
          next.status = "running";
          next.startedAt = Date.now();
          dispatchRunsUpdated(cur);
          advance(idx + 1);
          return;
        }

        // Final step done
        cur.status = fail ? "failed" : "ok";
        cur.endedAt = Date.now();
        cur.durationMs = cur.endedAt - cur.startedAt;
        if (!fail) cur.emittedEvent = (agent.emits && agent.emits[0]) || null;
        if (fail) cur.error = "Simulated failure (testAgent opts.fail)";
        dispatchRunsUpdated(cur);
        if (!fail) pushEvent(cur.emittedEvent, agent, cur.subject, cur.endedAt);
      }, delay);
    }
    advance(0);

    return run;
  };
})();
