import { auditLog, getDb } from "@agentic/db";
import { makeId } from "@agentic/shared";

export interface AuditEntry {
  tenantId: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}

export function writeAudit(entry: AuditEntry): void {
  const db = getDb();
  db.insert(auditLog)
    .values({
      id: makeId("aud"),
      tenantId: entry.tenantId,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metaJson: (entry.meta ?? null) as never,
    })
    .run();
}
