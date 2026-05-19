import { z } from "zod";

/**
 * All API responses use a uniform { ok, data } | { ok: false, error } envelope.
 * Per DESIGN.md §7.
 */

export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export function okResponse<T extends z.ZodTypeAny>(data: T) {
  return z.object({ ok: z.literal(true), data });
}

export function errorResponse() {
  return z.object({ ok: z.literal(false), error: ApiError });
}
