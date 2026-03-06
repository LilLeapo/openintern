import { parseWorkflowDefinition } from "../workflow/schema.js";
import { buildWorkflowDraftReviewUrl } from "../workflow/review-link.js";
import { WorkflowRepository } from "../workflow/repository.js";

export interface DraftReviewPayload {
  draftId: string;
  definition: unknown;
  normalized: ReturnType<typeof parseWorkflowDefinition> | null;
  valid: boolean;
  error: string | null;
  path: string;
  reviewUrl: string;
}

export async function loadWorkflowDraftReview(options: {
  repository: WorkflowRepository;
  draftId: string;
  gatewayHost: string;
  gatewayPort: number;
  publicBase?: string;
}): Promise<DraftReviewPayload> {
  const draftId = options.draftId.trim();
  const definition = await options.repository.loadDraft(draftId);
  const filePath = options.repository.resolveDraftPath(draftId);

  let normalized: ReturnType<typeof parseWorkflowDefinition> | null = null;
  let valid = true;
  let error: string | null = null;
  try {
    normalized = parseWorkflowDefinition(definition);
  } catch (validationError) {
    valid = false;
    error = validationError instanceof Error ? validationError.message : String(validationError);
  }

  return {
    draftId,
    definition,
    normalized,
    valid,
    error,
    path: filePath,
    reviewUrl: buildWorkflowDraftReviewUrl({
      draftId,
      gatewayHost: options.gatewayHost,
      gatewayPort: options.gatewayPort,
      publicBase: options.publicBase,
    }),
  };
}
