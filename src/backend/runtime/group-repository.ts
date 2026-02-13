import type { Pool } from 'pg';
import type { Group, CreateGroup, GroupMember, AddMember } from '../../types/orchestrator.js';
import { generateGroupId, generateGroupMemberId, generateAgentInstanceId } from '../../utils/ids.js';
import { NotFoundError } from '../../utils/errors.js';

interface GroupRow {
  id: string;
  name: string;
  description: string;
  project_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface MemberRow {
  id: string;
  group_id: string;
  role_id: string;
  agent_instance_id: string | null;
  ordinal: number;
  created_at: string | Date;
}

interface GroupWithRoleRow extends GroupRow {
  role_id: string | null;
  role_name: string | null;
  role_description: string | null;
}

export interface GroupRoleMember {
  role_id: string;
  role_name: string;
  role_description: string;
}

export interface GroupWithRoles extends Group {
  members: GroupRoleMember[];
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapGroupRow(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    project_id: row.project_id,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function mapMemberRow(row: MemberRow): GroupMember {
  return {
    id: row.id,
    group_id: row.group_id,
    role_id: row.role_id,
    agent_instance_id: row.agent_instance_id,
    ordinal: row.ordinal,
    created_at: toIso(row.created_at),
  };
}

export class GroupRepository {
  constructor(private readonly pool: Pool) {}

  // ─── Group CRUD ──────────────────────────────────────────

  async createGroup(input: CreateGroup): Promise<Group> {
    const id = generateGroupId();
    const result = await this.pool.query<GroupRow>(
      `INSERT INTO groups (id, name, description, project_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, input.name, input.description ?? '', input.project_id ?? null]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to create group');
    return mapGroupRow(row);
  }

  async getGroup(id: string): Promise<Group | null> {
    const result = await this.pool.query<GroupRow>(
      `SELECT * FROM groups WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? mapGroupRow(row) : null;
  }

  async requireGroup(id: string): Promise<Group> {
    const group = await this.getGroup(id);
    if (!group) throw new NotFoundError('Group', id);
    return group;
  }

  async listGroups(projectId?: string): Promise<Group[]> {
    if (projectId) {
      const result = await this.pool.query<GroupRow>(
        `SELECT * FROM groups WHERE project_id = $1 ORDER BY created_at DESC`,
        [projectId]
      );
      return result.rows.map(mapGroupRow);
    }
    const result = await this.pool.query<GroupRow>(
      `SELECT * FROM groups ORDER BY created_at DESC`
    );
    return result.rows.map(mapGroupRow);
  }

  // ─── Group + Roles query ────────────────────────────────

  async listGroupsWithRoles(projectId?: string): Promise<GroupWithRoles[]> {
    const params: unknown[] = [];
    let where = '';
    if (projectId) {
      params.push(projectId);
      where = 'WHERE g.project_id = $1';
    }

    const result = await this.pool.query<GroupWithRoleRow>(
      `SELECT g.*, r.id AS role_id, r.name AS role_name, r.description AS role_description
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id
       LEFT JOIN roles r ON r.id = gm.role_id
       ${where}
       ORDER BY g.created_at DESC, gm.ordinal ASC`,
      params
    );

    const groupMap = new Map<string, GroupWithRoles>();
    for (const row of result.rows) {
      let group = groupMap.get(row.id);
      if (!group) {
        group = { ...mapGroupRow(row), members: [] };
        groupMap.set(row.id, group);
      }
      if (row.role_id && row.role_name) {
        group.members.push({
          role_id: row.role_id,
          role_name: row.role_name,
          role_description: row.role_description ?? '',
        });
      }
    }

    return [...groupMap.values()];
  }

  // ─── Member Management ───────────────────────────────────

  async addMember(groupId: string, input: AddMember): Promise<GroupMember> {
    await this.requireGroup(groupId);
    const id = generateGroupMemberId();
    const instanceId = generateAgentInstanceId();

    // Create agent instance for this role in the group's project
    const group = await this.requireGroup(groupId);
    await this.pool.query(
      `INSERT INTO agent_instances (id, role_id, project_id)
       VALUES ($1, $2, $3)`,
      [instanceId, input.role_id, group.project_id]
    );

    const result = await this.pool.query<MemberRow>(
      `INSERT INTO group_members (id, group_id, role_id, agent_instance_id, ordinal)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, groupId, input.role_id, instanceId, input.ordinal ?? 0]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to add member');
    return mapMemberRow(row);
  }

  async listMembers(groupId: string): Promise<GroupMember[]> {
    const result = await this.pool.query<MemberRow>(
      `SELECT * FROM group_members WHERE group_id = $1 ORDER BY ordinal ASC`,
      [groupId]
    );
    return result.rows.map(mapMemberRow);
  }

  async removeMember(groupId: string, memberId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM group_members WHERE id = $1 AND group_id = $2`,
      [memberId, groupId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}
