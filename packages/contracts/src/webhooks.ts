import { z } from "zod";

export const WebhookResponse = z.object({
  provider: z.string(),
  event: z.string(),
});
