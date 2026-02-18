/**
 * API Client - handles all REST API calls to the backend
 */

import type {
  RunMeta,
  BlackboardMemory,
  Group,
  Role,
  Skill,
  GroupMember,
  GroupRunSummary,
  ChatMessageAttachment,
} from '../types';
import type {
  CreateRunResponse,
  ListRunsResponse,
  GetRunEventsResponse,
  Event,
} from '../types/events';

interface ScopeConfig {
  orgId: string;
  userId: string;
  projectId?: string;
}

export interface RunLLMConfig {
  provider?: 'openai' | 'anthropic' | 'gemini' | 'mock';
  model?: string;
  base_url?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface GetEventsOptions {
  includeTokens?: boolean;
  pageLimit?: number;
}

export class APIClient {
  private baseURL: string;
  private scope: ScopeConfig;

  constructor(
    baseURL: string = '',
    scope: ScopeConfig = {
      orgId: import.meta.env.VITE_ORG_ID ?? 'org_default',
      userId: import.meta.env.VITE_USER_ID ?? 'user_default',
      ...(import.meta.env.VITE_PROJECT_ID
        ? { projectId: import.meta.env.VITE_PROJECT_ID }
        : {}),
    }
  ) {
    this.baseURL = baseURL;
    this.scope = scope;
  }

  private buildScopeHeaders(): Record<string, string> {
    return {
      'x-org-id': this.scope.orgId,
      'x-user-id': this.scope.userId,
      ...(this.scope.projectId ? { 'x-project-id': this.scope.projectId } : {}),
    };
  }

  private async parseErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
      const error = (await response.json()) as {
        error?: { message?: string };
        message?: string;
      };
      return error.error?.message ?? error.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Create a new run
   */
  async createRun(
    sessionKey: string,
    input: string,
    llmConfig?: RunLLMConfig,
    attachments?: Array<{ upload_id: string }>
  ): Promise<CreateRunResponse> {
    const response = await fetch(`${this.baseURL}/api/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify({
        org_id: this.scope.orgId,
        user_id: this.scope.userId,
        ...(this.scope.projectId ? { project_id: this.scope.projectId } : {}),
        session_key: sessionKey,
        input,
        ...(llmConfig ? { llm_config: llmConfig } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      }),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to create run'),
        response.status
      );
    }

    return response.json();
  }

  /**
   * Upload a file
   */
  async uploadFile(file: File): Promise<ChatMessageAttachment> {
    const buffer = await file.arrayBuffer();

    const response = await fetch(`${this.baseURL}/api/uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': file.name,
        ...this.buildScopeHeaders(),
      },
      body: buffer,
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to upload file'),
        response.status
      );
    }

    const data = (await response.json()) as {
      upload_id: string;
      original_name: string;
      mime_type: string;
      size: number;
    };

    return {
      upload_id: data.upload_id,
      original_name: data.original_name,
      mime_type: data.mime_type,
      size: data.size,
    };
  }

  /**
   * Get run details
   */
  async getRun(runId: string): Promise<RunMeta> {
    const response = await fetch(`${this.baseURL}/api/runs/${runId}`, {
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to get run'),
        response.status
      );
    }

    return response.json();
  }

  /**
   * List runs for a session
   */
  async listRuns(
    sessionKey: string,
    page: number = 1,
    limit: number = 20
  ): Promise<ListRunsResponse> {
    const url = `${this.baseURL}/api/sessions/${sessionKey}/runs?page=${page}&limit=${limit}`;
    const response = await fetch(url, {
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to list runs'),
        response.status
      );
    }

    return response.json();
  }

  /**
   * Get events for a run
   */
  async getEvents(
    runId: string,
    type?: string,
    options: GetEventsOptions = {}
  ): Promise<Event[]> {
    const includeTokens = options.includeTokens ?? false;
    const pageLimit = options.pageLimit ?? 500;
    const events: Event[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const params = new URLSearchParams();
      params.set('limit', String(pageLimit));
      params.set('include_tokens', includeTokens ? 'true' : 'false');
      if (type) {
        params.set('type', type);
      }
      if (cursor) {
        params.set('cursor', cursor);
      }

      const response = await fetch(
        `${this.baseURL}/api/runs/${runId}/events?${params.toString()}`,
        {
          headers: this.buildScopeHeaders(),
        }
      );

      if (!response.ok) {
        throw new APIError(
          await this.parseErrorMessage(response, 'Failed to get events'),
          response.status
        );
      }

      const data: GetRunEventsResponse = await response.json();
      events.push(...data.events);
      const nextCursor = data.next_cursor ?? null;

      if (!nextCursor || seenCursors.has(nextCursor)) {
        break;
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    return events;
  }

  /**
   * Cancel a run
   */
  async cancelRun(runId: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/runs/${runId}/cancel`, {
      method: 'POST',
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to cancel run'),
        response.status
      );
    }
  }

  /**
   * List blackboard memories for a group
   */
  async getBlackboard(groupId: string): Promise<BlackboardMemory[]> {
    const response = await fetch(
      `${this.baseURL}/api/groups/${groupId}/blackboard`,
      { headers: this.buildScopeHeaders() }
    );

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to get blackboard'),
        response.status
      );
    }

    const data: { memories: BlackboardMemory[] } = await response.json();
    return data.memories;
  }

  /**
   * Get a single blackboard memory
   */
  async getBlackboardMemory(groupId: string, memoryId: string): Promise<BlackboardMemory> {
    const response = await fetch(
      `${this.baseURL}/api/groups/${groupId}/blackboard/${memoryId}`,
      { headers: this.buildScopeHeaders() }
    );

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to get memory'),
        response.status
      );
    }

    return response.json();
  }

  /**
   * Write to group blackboard
   */
  async writeBlackboard(
    groupId: string,
    body: {
      type: string;
      text: string;
      role_id: string;
      metadata?: Record<string, unknown>;
      importance?: number;
    }
  ): Promise<{ id: string }> {
    const response = await fetch(
      `${this.baseURL}/api/groups/${groupId}/blackboard`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.buildScopeHeaders(),
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to write to blackboard'),
        response.status
      );
    }

    return response.json();
  }

  /**
   * List groups
   */
  async listGroups(projectId?: string): Promise<Group[]> {
    const query = new URLSearchParams();
    if (projectId) {
      query.set('project_id', projectId);
    }
    const queryString = query.toString();
    const url = `${this.baseURL}/api/groups${queryString ? `?${queryString}` : ''}`;
    const response = await fetch(url, {
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to list groups'),
        response.status
      );
    }

    const data = (await response.json()) as { groups: Group[] };
    return data.groups;
  }

  /**
   * List roles
   */
  async listRoles(): Promise<Role[]> {
    const response = await fetch(`${this.baseURL}/api/roles`, {
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to list roles'),
        response.status
      );
    }

    const data = (await response.json()) as { roles: Role[] };
    return data.roles;
  }

  /**
   * Create role
   */
  async createRole(body: {
    name: string;
    system_prompt: string;
    description?: string;
    is_lead?: boolean;
    allowed_tools?: string[];
    denied_tools?: string[];
    style_constraints?: Record<string, unknown>;
  }): Promise<Role> {
    const response = await fetch(`${this.baseURL}/api/roles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to create role'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * List skills
   */
  async listSkills(): Promise<Skill[]> {
    const response = await fetch(`${this.baseURL}/api/skills`, {
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to list skills'),
        response.status,
      );
    }

    const data = (await response.json()) as { skills: Skill[] };
    return data.skills;
  }

  /**
   * Create skill
   */
  async createSkill(body: {
    name: string;
    description?: string;
    risk_level?: 'low' | 'medium' | 'high';
    provider?: 'builtin' | 'mcp';
    tools?: Array<{
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }>;
  }): Promise<Skill> {
    const response = await fetch(`${this.baseURL}/api/skills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to create skill'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Get one skill
   */
  async getSkill(skillId: string): Promise<Skill> {
    const response = await fetch(`${this.baseURL}/api/skills/${skillId}`, {
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to get skill'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Delete one skill
   */
  async deleteSkill(skillId: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/skills/${skillId}`, {
      method: 'DELETE',
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to delete skill'),
        response.status,
      );
    }
  }

  /**
   * Create group
   */
  async createGroup(body: {
    name: string;
    description?: string;
    project_id?: string | null;
  }): Promise<Group> {
    const response = await fetch(`${this.baseURL}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to create group'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * List members in a group
   */
  async listGroupMembers(groupId: string): Promise<GroupMember[]> {
    const response = await fetch(`${this.baseURL}/api/groups/${groupId}/members`, {
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to list group members'),
        response.status,
      );
    }

    const data = (await response.json()) as { members: GroupMember[] };
    return data.members;
  }

  /**
   * Add member to a group
   */
  async addGroupMember(
    groupId: string,
    body: {
      role_id: string;
      ordinal?: number;
    },
  ): Promise<GroupMember> {
    const response = await fetch(`${this.baseURL}/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to add group member'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Get child runs for a parent run
   */
  async getChildRuns(runId: string): Promise<RunMeta[]> {
    const response = await fetch(`${this.baseURL}/api/runs/${runId}/children`, {
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to get child runs'),
        response.status
      );
    }

    const data = (await response.json()) as { children: RunMeta[] };
    return data.children;
  }

  /**
   * Inject a user message into an active run
   */
  async injectMessage(runId: string, message: string, role?: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/runs/${runId}/inject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify({ message, ...(role ? { role } : {}) }),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to inject message'),
        response.status
      );
    }
  }

  /**
   * Create group run
   */
  async createGroupRun(
    groupId: string,
    body: {
      input: string;
      session_key?: string;
      llm_config?: {
        provider?: 'openai' | 'anthropic' | 'gemini' | 'mock';
        model?: string;
        base_url?: string;
        temperature?: number;
        max_tokens?: number;
      };
    },
  ): Promise<GroupRunSummary> {
    const response = await fetch(`${this.baseURL}/api/groups/${groupId}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to create group run'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Update a role
   */
  async updateRole(roleId: string, data: {
    name?: string;
    description?: string;
    system_prompt?: string;
    is_lead?: boolean;
    allowed_tools?: string[];
    denied_tools?: string[];
  }): Promise<Role> {
    const response = await fetch(`${this.baseURL}/api/roles/${roleId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to update role'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Delete a role
   */
  async deleteRole(roleId: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/roles/${roleId}`, {
      method: 'DELETE',
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to delete role'),
        response.status,
      );
    }
  }

  /**
   * Get role usage stats
   */
  async getRoleStats(roleId: string): Promise<{
    group_count: number;
    groups: Array<{ id: string; name: string }>;
  }> {
    const response = await fetch(`${this.baseURL}/api/roles/${roleId}/stats`, {
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to get role stats'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Batch delete roles
   */
  async batchDeleteRoles(ids: string[]): Promise<{ deleted: number }> {
    const response = await fetch(`${this.baseURL}/api/roles/batch-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify({ ids }),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to batch delete roles'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Update a group
   */
  async updateGroup(groupId: string, data: {
    name?: string;
    description?: string;
  }): Promise<Group> {
    const response = await fetch(`${this.baseURL}/api/groups/${groupId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to update group'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Delete a group
   */
  async deleteGroup(groupId: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/groups/${groupId}`, {
      method: 'DELETE',
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to delete group'),
        response.status,
      );
    }
  }

  /**
   * Get group usage stats
   */
  async getGroupStats(groupId: string): Promise<{
    run_count: number;
    completed_count: number;
    failed_count: number;
    success_rate: number;
    avg_duration_ms: number | null;
  }> {
    const response = await fetch(`${this.baseURL}/api/groups/${groupId}/stats`, {
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to get group stats'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Get group run history
   */
  async getGroupRuns(groupId: string, limit: number = 20, offset: number = 0): Promise<{
    runs: Array<{
      run_id: string;
      status: string;
      input: string;
      created_at: string;
      ended_at: string | null;
      duration_ms: number | null;
    }>;
  }> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const response = await fetch(
      `${this.baseURL}/api/groups/${groupId}/runs?${params.toString()}`,
      { headers: this.buildScopeHeaders() }
    );

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to get group runs'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Remove a member from a group
   */
  async removeGroupMember(groupId: string, memberId: string): Promise<void> {
    const response = await fetch(
      `${this.baseURL}/api/groups/${groupId}/members/${memberId}`,
      {
        method: 'DELETE',
        headers: this.buildScopeHeaders(),
      }
    );

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to remove group member'),
        response.status,
      );
    }
  }

  /**
   * Update a group member (ordinal)
   */
  async updateGroupMember(
    groupId: string,
    memberId: string,
    data: { ordinal?: number }
  ): Promise<GroupMember> {
    const response = await fetch(
      `${this.baseURL}/api/groups/${groupId}/members/${memberId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...this.buildScopeHeaders(),
        },
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to update group member'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Batch delete groups
   */
  async batchDeleteGroups(ids: string[]): Promise<{ deleted: number }> {
    const response = await fetch(`${this.baseURL}/api/groups/batch-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify({ ids }),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to batch delete groups'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Approve a tool call that requires approval
   */
  async approveToolCall(runId: string, toolCallId: string): Promise<{ success: boolean }> {
    const response = await fetch(`${this.baseURL}/api/runs/${runId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify({ tool_call_id: toolCallId }),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to approve tool call'),
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Reject a tool call that requires approval
   */
  async rejectToolCall(runId: string, toolCallId: string, reason?: string): Promise<{ success: boolean }> {
    const response = await fetch(`${this.baseURL}/api/runs/${runId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify({
        tool_call_id: toolCallId,
        ...(reason ? { reason } : {}),
      }),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to reject tool call'),
        response.status,
      );
    }

    return response.json();
  }
}

/**
 * API Error class
 */
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// Default client instance
export const apiClient = new APIClient();
