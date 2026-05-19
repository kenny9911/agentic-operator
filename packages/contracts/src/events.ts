import { z } from "zod";

export const IngestEventBody = z.object({
  name: z.string().min(1),
  subject: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type IngestEventBody = z.infer<typeof IngestEventBody>;

export const IngestEventResponse = z.object({
  event_id: z.string(),
  name: z.string(),
});

export const ReplayEventResponse = z.object({
  replayed: z.string(),
  new_event_id: z.string(),
});

export const EventRow = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string().nullable(),
  category: z.string().nullable(),
  color: z.string().nullable(),
  receivedAt: z.coerce.date().nullable(),
  sourceAgentName: z.string().nullable(),
  sourceAgentTitle: z.string().nullable(),
  payloadRef: z.string().nullable(),
});
export type EventRow = z.infer<typeof EventRow>;

export const ListEventsQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  name: z.string().optional(),
});
