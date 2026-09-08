import { LLMError } from "./errors";
import type { ChatMessage, ProviderId } from "./types";

/** Validate before projection so no adapter can discard or promote user media. */
export function assertMediaMessages(
  messages: ChatMessage[],
  provider: ProviderId,
  supported = true,
): void {
  for (const message of messages) {
    if (typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type !== "image" && block.type !== "document") continue;
      if (!supported) {
        throw new LLMError(
          `${provider} adapter does not support image or document inputs`,
          "bad_request",
          provider,
        );
      }
      if (message.role !== "user") {
        throw new LLMError(
          "Image and document inputs require a user message",
          "bad_request",
          provider,
        );
      }
    }
  }
}
