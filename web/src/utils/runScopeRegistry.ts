import type { ScopeConfig } from '../api/client';

const RUN_SCOPE_STORAGE_KEY = 'openintern.run_scope_registry.v1';

export interface RunScopeRecord {
  runId: string;
  orgId: string;
  userId: string;
  projectId: string | null;
  groupId?: string;
  createdAt: string;
}

function readRaw(): Record<string, RunScopeRecord> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(RUN_SCOPE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed as Record<string, RunScopeRecord>;
  } catch {
    return {};
  }
}

function writeRaw(map: Record<string, RunScopeRecord>): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(RUN_SCOPE_STORAGE_KEY, JSON.stringify(map));
}

export function readRunScopeRegistry(): Record<string, RunScopeRecord> {
  return readRaw();
}

export function recordRunScope(
  runId: string,
  scope: ScopeConfig,
  options: { groupId?: string } = {},
): void {
  const existing = readRaw();
  existing[runId] = {
    runId,
    orgId: scope.orgId,
    userId: scope.userId,
    projectId: scope.projectId ?? null,
    ...(options.groupId ? { groupId: options.groupId } : {}),
    createdAt: new Date().toISOString(),
  };
  writeRaw(existing);
}
