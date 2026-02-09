import type { Scope } from '../../types/scope.js';

export interface ScopeContext {
  orgId: string;
  userId: string;
  projectId: string | null;
}

export function toScopeContext(scope: Scope): ScopeContext {
  return {
    orgId: scope.org_id,
    userId: scope.user_id,
    projectId: scope.project_id ?? null,
  };
}

export function appendScopePredicate(
  clauses: string[],
  params: unknown[],
  scope: ScopeContext,
  alias?: string
): void {
  const prefix = alias ? `${alias}.` : '';
  const orgIndex = params.push(scope.orgId);
  const userIndex = params.push(scope.userId);
  const projectIndex = params.push(scope.projectId);
  clauses.push(`${prefix}org_id = $${orgIndex}`);
  clauses.push(`${prefix}user_id = $${userIndex}`);
  clauses.push(`${prefix}project_id IS NOT DISTINCT FROM $${projectIndex}`);
}
