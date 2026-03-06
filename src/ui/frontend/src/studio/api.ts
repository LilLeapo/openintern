import type { ApiEnvelope } from "./types";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(payload?.message ?? `HTTP ${response.status}`);
  }
  return payload.data;
}
