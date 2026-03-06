import { MemoryRetrieveTool, MemorySaveTool, type MemoryScopeResolver } from "./memory.js";
import type { MemUClient } from "../../agent/memory/memu-client.js";

type ScopedMemory = "chat" | "papers";

export class ScopedMemorySaveTool extends MemorySaveTool {
  constructor(
    memu: MemUClient,
    resolveScope: MemoryScopeResolver,
    private readonly forcedScope: ScopedMemory,
  ) {
    super(memu, resolveScope);
  }

  override async execute(params: Record<string, unknown>): Promise<string> {
    return super.execute({
      ...params,
      scope: this.forcedScope,
    });
  }
}

export class ScopedMemoryRetrieveTool extends MemoryRetrieveTool {
  constructor(
    memu: MemUClient,
    resolveScope: MemoryScopeResolver,
    private readonly forcedScope: ScopedMemory,
  ) {
    super(memu, resolveScope);
  }

  override async execute(params: Record<string, unknown>): Promise<string> {
    return super.execute({
      ...params,
      scope: this.forcedScope,
    });
  }
}
