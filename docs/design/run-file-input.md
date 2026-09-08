# File input, context, and memory for runs

Workflow Run and the agent Test Lab accept uploaded files alongside the user's prompt and structured inputs. Each upload is parsed through the authenticated tenant's LLM gateway. The user can review and edit the extracted text, remove a file, or retry a failed extraction before starting the run. Run controls remain disabled while an attachment is pending or failed.

Chat can run from reviewed attachments alone, using a neutral instruction to follow the agent or workflow instructions. Test Lab uses its selected provider and model for parsing; workflow uploads use the tenant gateway default.

## Supported files and limits

- PDF; PNG, JPEG, GIF, and WebP images.
- UTF-8 TXT, Markdown, CSV, TSV, JSON, XML, HTML, and LOG files.
- Up to five attachments, at most 8 MiB each.
- Text source files: at most 128,000 characters. Extracted text, prompt, and additional context: at most 32,000 characters each; combined run input: at most 100,000 characters.

Images and PDFs use native model input blocks through OpenAI chat/Responses, Anthropic, or Gemini. The configured model must support the uploaded format. Unsupported providers, malformed files, empty responses, and token-truncated extractions fail visibly. There is no mock or OCR fallback. DOC/DOCX, XLS/XLSX, archives, audio, and video are not accepted; export these to a supported format first.

Original file bytes remain request-local and are sent to the parsing provider; they are not saved as run artifacts. Reviewed text is user input and can be recorded in events, run artifacts, session messages, and memory under the existing tenant storage controls. File identifiers are content hashes for correlation, not authorization tokens or stored-file references.

## Context and continuity

Additional context and reviewed attachment text reach LLM calls as user content, preserving the authored system prompt and input mappings. Workflow events explicitly carry this context through downstream execution and event replay. Code-defined agents receive `AgentContext.runInput` and a memory handle; generated CodeAct reasoning receives the same user context.

An optional context key enables durable recall of up to four recent successful runs of the same agent in the same tenant. Each remembered input and output is bounded to 3,000 characters, so this is reference material rather than a full transcript or searchable document archive. A blank key disables automatic recall across independent runs. A different key starts a separate context. Existing agent session conversations and manifest memory configuration continue to work.

Draft workflow memory uses a separate namespace that includes the workflow and agent identity. Simulated draft results do not become live workflow memory. Production history is recalled only for successful run rows, excluding failed and cancelled attempts. Memory writes use one row per run for replay idempotency, retain a bounded window, and honor `MEMORY_TTL_DAYS` when configured. Existing manifest subject memory remains separate from context-key history.

## API

`POST /v1/run-inputs/parse` requires `agents.invoke` permission. Its JSON request is `{name, mimeType, base64, provider?, model?}`. The response envelope contains `{id, name, mimeType, size, text}`. Its bounded body limit is specific to this upload endpoint.

Invoke, event publish, workflow draft test, and Agent Studio run requests accept a top-level `runInput`:

```json
{
  "runInput": {
    "prompt": "Compare this invoice with the previous one.",
    "context": "Report amounts in SGD.",
    "contextKey": "invoice-review-2026-09",
    "attachments": [
      {
        "id": "attachment-content-hash",
        "name": "invoice.pdf",
        "mimeType": "application/pdf",
        "size": 12000,
        "text": "Reviewed invoice text..."
      }
    ]
  }
}
```

All fields inside `runInput` are optional. Structured workflow ports still use the normal `input`, `inputs`, or `payload` fields; attachments do not bypass their validation. The API validates the shared `RunInputContextSchema` and places run input in reserved `__runInput` broker metadata so it cannot collide with strict business payload schemas. The runtime validates it again at the execution boundary.

Provider mappings follow the primary documentation for [OpenAI file input](https://developers.openai.com/api/docs/guides/file-inputs), [OpenAI image input](https://developers.openai.com/api/docs/guides/images-vision), [Anthropic PDF input](https://platform.claude.com/docs/en/build-with-claude/pdf-support), and [Gemini content parts](https://ai.google.dev/api/caching).

## Verification (2026-09-09)

- Node 26.8.1; `pnpm build`, `pnpm typecheck` (28 workspaces), and `pnpm lint` passed. The isolated build used an ignored local `.env` containing the required `AGENTIC_API_URL`.
- API suite: 299 files passed, 2 skipped; 2,203 tests passed, 8 skipped. Web suite: 110 files and 1,010 tests passed.
- Runtime, code-agent, contracts, tools, agent-factory, ontology-compiler, CLI, Codex harness, and mock-ERP suites passed separately. Existing Docker/environment-dependent tests remain skipped.
- Browser checks exercised real run components against a test API: upload, edited extraction, parser failure and retry, workflow payload/chat submission, and the active Agent Studio run endpoint. Temporary verification routes and servers were removed. Provider payload tests capture HTTP requests; no paid live model inference was needed for these checks.
- The aggregate `pnpm test` command has a pre-existing missing `artifacts/ontology/Agents-generation/v0_4_001/release_bundle_v0_4_001.json` fixture. The unfiltered workspace test runner also fails because `@agentic/mcp` declares a test command but contains no tests. Neither unrelated test entry point was weakened or changed.
