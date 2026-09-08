import { z } from "zod";

export const RUN_INPUT_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const RUN_INPUT_MAX_ATTACHMENTS = 5;
export const RUN_INPUT_MAX_TEXT_CHARS = 32_000;
export const RUN_INPUT_MAX_TOTAL_CHARS = 100_000;

/** Parsed text is editable user input. It never grants access to stored files. */
export const RunInputAttachmentSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().min(0).max(RUN_INPUT_MAX_FILE_BYTES),
  text: z.string().max(RUN_INPUT_MAX_TEXT_CHARS),
});
export type RunInputAttachment = z.infer<typeof RunInputAttachmentSchema>;

export const RunInputContextSchema = z
  .object({
    prompt: z.string().max(RUN_INPUT_MAX_TEXT_CHARS).optional(),
    context: z.string().max(RUN_INPUT_MAX_TEXT_CHARS).optional(),
    contextKey: z.string().trim().min(1).max(160).optional(),
    attachments: z
      .array(RunInputAttachmentSchema)
      .max(RUN_INPUT_MAX_ATTACHMENTS)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const total =
      (value.prompt?.length ?? 0) +
      (value.context?.length ?? 0) +
      (value.attachments ?? []).reduce(
        (sum, file) => sum + file.text.length,
        0,
      );
    if (total > RUN_INPUT_MAX_TOTAL_CHARS) {
      ctx.addIssue({
        code: "custom",
        message: `Run input exceeds ${RUN_INPUT_MAX_TOTAL_CHARS} characters; shorten the prompt, context, or parsed attachments.`,
      });
    }
  });
export type RunInputContext = z.infer<typeof RunInputContextSchema>;

export const ParseRunInputBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    mimeType: z.string().max(120).default(""),
    base64: z
      .string()
      .min(4)
      .max(4 * Math.ceil(RUN_INPUT_MAX_FILE_BYTES / 3)),
    provider: z.string().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(160).optional(),
  })
  .strict();
export type ParseRunInputBody = z.infer<typeof ParseRunInputBodySchema>;
