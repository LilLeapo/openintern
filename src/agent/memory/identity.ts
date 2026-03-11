import type { MemoryConfig, MemoryOwnerType } from "../../config/schema.js";

type MemoryScope = "chat" | "papers";

export interface MemoryIdentityInput {
  channel: string;
  chatId: string;
  senderId?: string;
  metadata?: Record<string, unknown>;
  scope: MemoryScope;
}

export interface MemoryIdentity {
  tenantId: string;
  principalId: string;
  conversationId: string;
  knowledgeBaseId: string;
  ownerType: MemoryOwnerType;
  ownerId: string;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function compactSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:@/-]+/g, "_");
}

export function resolveMemoryIdentity(
  input: MemoryIdentityInput,
  config: MemoryConfig,
): MemoryIdentity {
  const configuredTenant = config.isolation.tenantId.trim() || "default";
  const tenantId = metadataString(input.metadata, "tenant_id") ?? configuredTenant;
  const conversationId =
    metadataString(input.metadata, "conversation_id") ??
    `${input.channel}:${input.chatId}`;
  const principalId =
    metadataString(input.metadata, "principal_id") ??
    (input.senderId?.trim() ? `${input.channel}:${input.senderId.trim()}` : conversationId);
  const knowledgeBaseId =
    metadataString(input.metadata, "knowledge_base_id") ??
    metadataString(input.metadata, "kb_id") ??
    conversationId;
  const ownerType = config.isolation.scopeOwners[input.scope];
  const ownerId =
    ownerType === "principal"
      ? principalId
      : ownerType === "knowledgeBase"
        ? knowledgeBaseId
        : conversationId;

  return {
    tenantId: compactSegment(tenantId),
    principalId: compactSegment(principalId),
    conversationId: compactSegment(conversationId),
    knowledgeBaseId: compactSegment(knowledgeBaseId),
    ownerType,
    ownerId: compactSegment(ownerId),
  };
}

export function buildMemuUserId(identity: MemoryIdentity): string {
  return `tenant:${identity.tenantId}:${identity.ownerType}:${identity.ownerId}`;
}

export function buildLocalMemoryNamespace(sessionKey: string): string {
  return `sessions/${compactSegment(sessionKey)}`;
}
