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
  async createRun(sessionKey: string, input: string): Promise<CreateRunResponse> {
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
  async getEvents(runId: string, type?: string): Promise<Event[]> {
    let url = `${this.baseURL}/api/runs/${runId}/events`;
    if (type) {
      url += `?type=${encodeURIComponent(type)}`;
    }

    const response = await fetch(url, {
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      throw new APIError(
        await this.parseErrorMessage(response, 'Failed to get events'),
        response.status
      );
    }

    const data: GetRunEventsResponse = await response.json();
    return data.events;
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
   * Create group run
   */
  async createGroupRun(
    groupId: string,
    body: {
      input: string;
      session_key?: string;
      llm_config?: {
        provider?: 'openai' | 'anthropic' | 'mock';
        model?: string;
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
