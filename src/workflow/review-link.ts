function normalizeHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed || trimmed === "0.0.0.0" || trimmed === "::") {
    return "127.0.0.1";
  }
  return trimmed;
}

export function buildWorkflowDraftReviewUrl(options: {
  draftId: string;
  gatewayHost: string;
  gatewayPort: number;
  publicBase?: string;
}): string {
  const draftQuery = encodeURIComponent(options.draftId);
  const envBase = options.publicBase?.trim() ?? "";

  if (envBase) {
    const base = envBase.replace(/\/$/, "");
    return `${base}/workflow?draft=${draftQuery}`;
  }

  const host = normalizeHost(options.gatewayHost);
  const uiPort = options.gatewayPort + 1;
  return `http://${host}:${uiPort}/workflow?draft=${draftQuery}`;
}
