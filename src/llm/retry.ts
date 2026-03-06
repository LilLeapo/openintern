const MAX_LLM_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_BASE_MS = 400;
const RETRY_DELAY_MAX_MS = 2_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Aborted"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function llmMaxAttempts(): number {
  return MAX_LLM_RETRY_ATTEMPTS;
}

export function shouldRetryHttpStatus(status: number): boolean {
  if (status === 408 || status === 409 || status === 425 || status === 429) {
    return true;
  }
  return status >= 500;
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String((error as { name?: unknown }).name) : "";
  return name === "AbortError";
}

export function isRetryableFetchError(error: unknown): boolean {
  if (isAbortError(error)) {
    return false;
  }

  if (error instanceof TypeError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("eai_again") ||
    message.includes("enotfound")
  );
}

export async function waitBeforeRetry(attempt: number, signal?: AbortSignal): Promise<void> {
  const delay = Math.min(RETRY_DELAY_BASE_MS * 2 ** (attempt - 1), RETRY_DELAY_MAX_MS);
  await sleep(delay, signal);
}
