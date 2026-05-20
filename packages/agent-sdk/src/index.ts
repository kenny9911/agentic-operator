export { defineTool, type DefineToolInput } from "./define-tool";
export { definePrompt, type DefinePromptInput } from "./define-prompt";
export type {
  ToolContext,
  ToolResult,
  ToolDescriptor,
  PromptDescriptor,
  TenantRegistry,
} from "./types";
export type {
  MemoryHandle,
  MemoryScope,
  MemoryBinding,
  MemoryDriverRef,
} from "./memory";
export {
  type MemoryDriver,
  type MemoryHit,
  NoMemoryDriverError,
} from "./memory-driver";
