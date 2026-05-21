"use client";

/**
 * Tenants — workspace management table (P5-TEN-01b).
 *
 * Production sibling to the SPA's `apps/web/public/demo/views/tenants.jsx`.
 * Lists every tenant the operator can see (active + optionally archived),
 * with inline edit / archive / restore actions and an entry point into the
 * 4-step create wizard that the sidebar TenantSwitcher already mounts.
 *
 * Why this lives at `/portal/<tenant>/tenants` rather than `/portal/tenants`:
 * the App Router shell (`apps/web/app/portal/[tenant]/layout.tsx`) owns the
 * sidebar + topbar + provider tree. Putting this view under `[tenant]`
 * keeps it inside that shell with no special-case routing.
 *
 * Mutations: `useUpdateTenant`, `useArchiveTenant`, `useRestoreTenant` —
 * hooks below speak directly to the api with `credentials: "same-origin"`
 * so the session cookie carries over. Each mutation invalidates
 * `TENANTS_KEYS.all` so the sidebar dropdown reflects the change.
 *
 * Bootstrap-token reveal: the sidebar already shows the one-shot modal on
 * successful create. This table only handles updates / archive / restore,
 * none of which produce a token.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Empty,
  Icon,
  Panel,
  ViewHeader,
  ModalOverlay,
  useToast,
} from "@/app/portal/components";
import { fmtAgo } from "@/app/portal/lib/format";
import {
  TENANTS_KEYS,
  useTenants,
  type TenantListItem,
} from "@/lib/hooks/useTenants";

const DEFAULT_COLORS = [
  "#d0ff00",
  "#7c9eff",
  "#f5c46b",
  "#65e0a3",
  "#b594ff",
  "#ff6470",
  "#5deeff",
  "#ffb547",
];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: { code: string; message: string };
}

async function callV1<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
    ...init,
  });
  const body = (await res.json()) as ApiOk<T> | ApiErr;
  if (!body.ok) {
    const e = new Error(body.error.message);
    (e as Error & { code?: string }).code = body.error.code;
    throw e;
  }
  return body.data;
}

interface UpdateInput {
  slug: string;
  patch: { name?: string; subtitle?: string | null; color?: string | null };
}

function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateInput) =>
      callV1<TenantListItem>(`/v1/tenants/${input.slug}`, {
        method: "PUT",
        body: JSON.stringify(input.patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TENANTS_KEYS.all });
    },
  });
}

interface ArchiveInput {
  slug: string;
  confirm: string;
  reason?: string;
}

function useArchiveTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ArchiveInput) =>
      callV1<{ slug: string; archivedAt: number }>(
        `/v1/tenants/${input.slug}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            confirm: input.confirm,
            reason: input.reason,
          }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TENANTS_KEYS.all });
    },
  });
}

function useRestoreTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      callV1<TenantListItem>(`/v1/tenants/${slug}/restore`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TENANTS_KEYS.all });
    },
  });
}

export default function TenantsPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editTarget, setEditTarget] = useState<TenantListItem | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<TenantListItem | null>(
    null,
  );
  const toast = useToast();
  const restore = useRestoreTenant();

  const query = useTenants({ includeArchived });

  function handleRestore(slug: string) {
    restore.mutate(slug, {
      onSuccess: () =>
        toast({ tone: "green", title: "Tenant restored", description: slug }),
      onError: (err) =>
        toast({
          tone: "red",
          title: "Restore failed",
          description: (err as Error).message,
        }),
    });
  }

  const rows = query.data?.items ?? [];

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "20px 24px" }}>
      <ViewHeader
        title="Tenants"
        subtitle="Workspace boundaries. Each tenant is an isolated stack of agents, workflows, runs, events, budgets, and audit trail."
        badge={
          <Badge tone="muted" style={{ fontFamily: "var(--mono)" }}>
            {rows.length} {rows.length === 1 ? "TENANT" : "TENANTS"}
          </Badge>
        }
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 14,
          fontSize: 12,
          color: "var(--text-3)",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
        <button
          onClick={() => query.refetch()}
          style={{
            padding: "3px 8px",
            border: "1px solid var(--border-2)",
            borderRadius: 4,
            color: "var(--text-2)",
            fontSize: 11,
            background: "transparent",
          }}
        >
          Refresh
        </button>
        <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>
          Use the sidebar tenant switcher to create new tenants.
        </span>
      </div>

      {query.isError && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: 12,
            background: "rgba(255,100,112,0.08)",
            border: "1px solid rgba(255,100,112,0.3)",
            borderRadius: 4,
            color: "var(--red)",
            fontSize: 12,
          }}
        >
          {(query.error as Error).message}
        </div>
      )}

      {query.isLoading && rows.length === 0 ? (
        <Empty title="Loading tenants…" hint="One moment." />
      ) : rows.length === 0 ? (
        <Empty
          title="No tenants visible"
          hint={
            includeArchived
              ? "There are no tenants at all yet. Use the sidebar switcher to create one."
              : "All tenants are archived. Toggle 'Show archived' to see them."
          }
        />
      ) : (
        <TenantsTable
          rows={rows}
          onEdit={setEditTarget}
          onArchive={setArchiveTarget}
          onRestore={handleRestore}
        />
      )}

      {editTarget && (
        <EditModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={(slug) => {
            setEditTarget(null);
            toast({
              tone: "green",
              title: "Tenant updated",
              description: slug,
            });
          }}
        />
      )}
      {archiveTarget && (
        <ArchiveModal
          target={archiveTarget}
          onClose={() => setArchiveTarget(null)}
          onArchived={(slug) => {
            setArchiveTarget(null);
            toast({
              tone: "amber",
              title: "Tenant archived",
              description: slug,
            });
          }}
        />
      )}
    </div>
  );
}

// ─── Table ─────────────────────────────────────────────────────────────────

function TenantsTable({
  rows,
  onEdit,
  onArchive,
  onRestore,
}: {
  rows: TenantListItem[];
  onEdit: (t: TenantListItem) => void;
  onArchive: (t: TenantListItem) => void;
  onRestore: (slug: string) => void;
}) {
  return (
    <Panel padded={false}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "32px 1.2fr 1.4fr 80px 80px 80px 1fr 200px",
          gap: 12,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          fontSize: 10,
          fontFamily: "var(--mono)",
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        <div></div>
        <div>Tenant</div>
        <div>Description</div>
        <div style={{ textAlign: "right" }}>Agents</div>
        <div style={{ textAlign: "right" }}>Runs/24h</div>
        <div style={{ textAlign: "right" }}>Open tasks</div>
        <div>Created</div>
        <div></div>
      </div>
      {rows.map((t) => (
        <Row
          key={t.slug}
          tenant={t}
          onEdit={() => onEdit(t)}
          onArchive={() => onArchive(t)}
          onRestore={() => onRestore(t.slug)}
        />
      ))}
    </Panel>
  );
}

function Row({
  tenant,
  onEdit,
  onArchive,
  onRestore,
}: {
  tenant: TenantListItem;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const archived = !!tenant.archivedAt;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1.2fr 1.4fr 80px 80px 80px 1fr 200px",
        gap: 12,
        padding: "12px 14px",
        borderBottom: "1px solid var(--border)",
        alignItems: "center",
        opacity: archived ? 0.55 : 1,
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 4,
          background: tenant.color ?? "#6f7178",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#000",
          fontFamily: "var(--mono)",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {tenant.name[0] ?? "?"}
      </div>
      <div>
        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 500 }}>
          {tenant.name}
        </div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--text-3)",
          }}
        >
          {tenant.slug}
          {archived && (
            <Badge tone="amber" style={{ marginLeft: 8, fontSize: 9 }}>
              ARCHIVED
            </Badge>
          )}
        </div>
      </div>
      <div
        style={{
          color: "var(--text-2)",
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {tenant.subtitle ?? (
          <span style={{ color: "var(--text-4)" }}>—</span>
        )}
      </div>
      <div
        style={{
          textAlign: "right",
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: "var(--text)",
        }}
      >
        {tenant.agentCount}
      </div>
      <div
        style={{
          textAlign: "right",
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: "var(--text)",
        }}
      >
        {tenant.runs24h}
      </div>
      <div
        style={{
          textAlign: "right",
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: tenant.openTasks > 0 ? "var(--amber)" : "var(--text)",
        }}
      >
        {tenant.openTasks}
      </div>
      <div
        style={{
          color: "var(--text-3)",
          fontSize: 11,
          fontFamily: "var(--mono)",
        }}
      >
        {fmtAgo(tenant.createdAt)}
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {!archived ? (
          <>
            <button
              onClick={onEdit}
              style={{
                padding: "3px 8px",
                border: "1px solid var(--border-2)",
                borderRadius: 4,
                fontSize: 11,
                color: "var(--text-2)",
                background: "transparent",
              }}
            >
              Edit
            </button>
            <button
              onClick={onArchive}
              style={{
                padding: "3px 8px",
                border: "1px solid rgba(255,100,112,0.3)",
                borderRadius: 4,
                fontSize: 11,
                color: "var(--red)",
                background: "transparent",
              }}
            >
              Archive
            </button>
          </>
        ) : (
          <button
            onClick={onRestore}
            style={{
              padding: "3px 8px",
              border: "1px solid var(--border-2)",
              borderRadius: 4,
              fontSize: 11,
              color: "var(--text-2)",
              background: "transparent",
            }}
          >
            Restore
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Edit modal ────────────────────────────────────────────────────────────

function EditModal({
  target,
  onClose,
  onUpdated,
}: {
  target: TenantListItem;
  onClose: () => void;
  onUpdated: (slug: string) => void;
}) {
  const [name, setName] = useState(target.name);
  const [subtitle, setSubtitle] = useState(target.subtitle ?? "");
  const [color, setColor] = useState(target.color ?? DEFAULT_COLORS[0]!);
  const update = useUpdateTenant();

  const colorOk = HEX_COLOR_RE.test(color);
  const canSave =
    name.trim().length > 0 && colorOk && !update.isPending;

  function submit() {
    if (!canSave) return;
    update.mutate(
      {
        slug: target.slug,
        patch: {
          name: name.trim(),
          subtitle: subtitle.trim() || null,
          color,
        },
      },
      {
        onSuccess: () => onUpdated(target.slug),
      },
    );
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        style={{
          width: 480,
          maxWidth: "92vw",
          background: "var(--panel)",
          border: "1px solid var(--border-2)",
          borderRadius: 6,
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
            Edit tenant · {target.slug}
          </div>
          <button onClick={onClose} style={{ color: "var(--text-3)", padding: 4, background: "transparent", border: "none" }}>
            <Icon name="x" size={12} />
          </button>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {update.isError && (
            <div
              style={{
                padding: "8px 12px",
                background: "rgba(255,100,112,0.08)",
                border: "1px solid rgba(255,100,112,0.3)",
                borderRadius: 4,
                color: "var(--red)",
                fontSize: 12,
              }}
            >
              {(update.error as Error).message}
            </div>
          )}
          <Field label="Display name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle()}
            />
          </Field>
          <Field label="Subtitle">
            <input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              style={inputStyle()}
            />
          </Field>
          <Field label="Accent color" error={!colorOk ? "must be #rrggbb hex" : null}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  type="button"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 5,
                    background: c,
                    border:
                      color === c
                        ? "2px solid var(--text)"
                        : "1px solid var(--border-2)",
                    cursor: "pointer",
                  }}
                  title={c}
                />
              ))}
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                style={{
                  ...inputStyle(),
                  width: 110,
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                }}
              />
            </div>
          </Field>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            Slug is immutable. To rename, archive this tenant and create a
            new one.
          </div>
        </div>
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "6px 12px",
              border: "1px solid var(--border-2)",
              borderRadius: 4,
              fontSize: 12,
              color: "var(--text-2)",
              background: "transparent",
            }}
          >
            Cancel
          </button>
          <Button tone="primary" disabled={!canSave} onClick={submit}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ─── Archive modal (confirm by typing slug) ───────────────────────────────

function ArchiveModal({
  target,
  onClose,
  onArchived,
}: {
  target: TenantListItem;
  onClose: () => void;
  onArchived: (slug: string) => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const archive = useArchiveTenant();

  function submit() {
    if (confirm !== target.slug || archive.isPending) return;
    archive.mutate(
      {
        slug: target.slug,
        confirm,
        reason: reason.trim() || undefined,
      },
      {
        onSuccess: () => onArchived(target.slug),
      },
    );
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        style={{
          width: 480,
          maxWidth: "92vw",
          background: "var(--panel)",
          border: "1px solid var(--border-2)",
          borderRadius: 6,
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
            Archive tenant · {target.slug}
          </div>
          <button onClick={onClose} style={{ color: "var(--text-3)", padding: 4, background: "transparent", border: "none" }}>
            <Icon name="x" size={12} />
          </button>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {archive.isError && (
            <div
              style={{
                padding: "8px 12px",
                background: "rgba(255,100,112,0.08)",
                border: "1px solid rgba(255,100,112,0.3)",
                borderRadius: 4,
                color: "var(--red)",
                fontSize: 12,
              }}
            >
              {(archive.error as Error).message}
            </div>
          )}
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
            Archiving "{target.name}" hides it from the switcher and disables
            its API tokens, but preserves all rows for audit. You can restore
            later. Active runs and open tasks must be resolved first.
          </div>
          <Field label={`Type "${target.slug}" to confirm`}>
            <input
              autoFocus
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={target.slug}
              style={{ ...inputStyle(), fontFamily: "var(--mono)" }}
            />
          </Field>
          <Field label="Reason (optional)">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              style={{
                ...inputStyle(),
                resize: "vertical",
                minHeight: 60,
              }}
            />
          </Field>
        </div>
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "6px 12px",
              border: "1px solid var(--border-2)",
              borderRadius: 4,
              fontSize: 12,
              color: "var(--text-2)",
              background: "transparent",
            }}
          >
            Cancel
          </button>
          <Button
            tone="danger"
            disabled={confirm !== target.slug || archive.isPending}
            onClick={submit}
          >
            {archive.isPending ? "Archiving…" : "Archive"}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ─── Layout primitives ─────────────────────────────────────────────────────

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--mono)",
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      {children}
      {error && (
        <div style={{ fontSize: 11, color: "var(--red)" }}>{error}</div>
      )}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    padding: "7px 10px",
    background: "var(--bg)",
    border: "1px solid var(--border-2)",
    borderRadius: 4,
    color: "var(--text)",
    fontSize: 13,
    fontFamily: "var(--sans)",
    width: "100%",
  };
}
