/**
 * Cross-package types. Mostly re-exports from manifest + DB.
 * Concrete types live in their owning package (db.schema, runtime.manifest);
 * this file is for shared shapes used by both portal + runtime.
 */

export type RunStatus =
  | "queued"
  | "running"
  | "ok"
  | "failed"
  | "waiting"
  | "cancelled";

export type StepType = "tool" | "logic" | "manual";
export type StepStatus = "pending" | "running" | "ok" | "failed" | "skipped";

export type TaskStatus = "open" | "resolved" | "snoozed";

export type Role = "admin" | "operator" | "viewer";

export type DeploymentStatus = "live" | "rolled_back" | "pending";

export type Actor = "Agent" | "Human";
