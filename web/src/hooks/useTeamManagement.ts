/**
 * useTeamManagement - hook for team management data and operations
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import type { Group, GroupMember, Role } from '../types';

export type ResourceTab = 'roles' | 'groups';
export type RoleFilter = 'all' | 'lead' | 'non-lead';

export interface SelectedResource {
  type: 'role' | 'group';
  id: string;
}

export interface RoleStats {
  group_count: number;
  groups: Array<{ id: string; name: string }>;
}

export interface GroupStats {
  run_count: number;
  completed_count: number;
  failed_count: number;
  success_rate: number;
  avg_duration_ms: number | null;
}

export interface GroupRunRecord {
  run_id: string;
  status: string;
  input: string;
  created_at: string;
  ended_at: string | null;
  duration_ms: number | null;
}

export function useTeamManagement() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, GroupMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [activeTab, setActiveTab] = useState<ResourceTab>('roles');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [selected, setSelected] = useState<SelectedResource | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const [roleStats, setRoleStats] = useState<RoleStats | null>(null);
  const [groupStats, setGroupStats] = useState<GroupStats | null>(null);
  const [groupRuns, setGroupRuns] = useState<GroupRunRecord[]>([]);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextRoles, nextGroups] = await Promise.all([
        apiClient.listRoles(),
        apiClient.listGroups(),
      ]);
      setRoles(nextRoles);
      setGroups(nextGroups);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load catalog'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // Load members for a group
  const loadMembers = useCallback(async (groupId: string) => {
    try {
      const members = await apiClient.listGroupMembers(groupId);
      setMembersByGroup(prev => ({ ...prev, [groupId]: members }));
    } catch (_err) {
      // silently fail
    }
  }, []);

  // Load stats when selection changes
  useEffect(() => {
    if (!selected) {
      setRoleStats(null);
      setGroupStats(null);
      setGroupRuns([]);
      return;
    }
    if (selected.type === 'role') {
      void (async () => {
        try {
          const stats = await apiClient.getRoleStats(selected.id);
          setRoleStats(stats);
        } catch (_err) {
          setRoleStats(null);
        }
      })();
    } else {
      void (async () => {
        try {
          const [stats, runsData] = await Promise.all([
            apiClient.getGroupStats(selected.id),
            apiClient.getGroupRuns(selected.id),
          ]);
          setGroupStats(stats);
          setGroupRuns(runsData.runs);
        } catch (_err) {
          setGroupStats(null);
          setGroupRuns([]);
        }
      })();
      if (!membersByGroup[selected.id]) {
        void loadMembers(selected.id);
      }
    }
  }, [selected, membersByGroup, loadMembers]);

  // Filtered lists
  const filteredRoles = useMemo(() => {
    let result = roles;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
    }
    if (roleFilter === 'lead') result = result.filter(r => r.is_lead);
    if (roleFilter === 'non-lead') result = result.filter(r => !r.is_lead);
    return result;
  }, [roles, searchQuery, roleFilter]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery) return groups;
    const q = searchQuery.toLowerCase();
    return groups.filter(g => g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q));
  }, [groups, searchQuery]);

  // CRUD operations
  const createRole = useCallback(async (data: {
    name: string;
    system_prompt: string;
    description?: string;
    is_lead?: boolean;
    allowed_tools?: string[];
    denied_tools?: string[];
  }) => {
    const created = await apiClient.createRole(data);
    setRoles(prev => [created, ...prev]);
    setSelected({ type: 'role', id: created.id });
    showToast('success', `Created role: ${created.name}`);
    return created;
  }, [showToast]);

  const updateRole = useCallback(async (roleId: string, data: {
    name?: string;
    description?: string;
    system_prompt?: string;
    is_lead?: boolean;
    allowed_tools?: string[];
    denied_tools?: string[];
  }) => {
    const updated = await apiClient.updateRole(roleId, data);
    setRoles(prev => prev.map(r => r.id === roleId ? updated : r));
    showToast('success', `Updated role: ${updated.name}`);
    return updated;
  }, [showToast]);

  const deleteRole = useCallback(async (roleId: string) => {
    await apiClient.deleteRole(roleId);
    setRoles(prev => prev.filter(r => r.id !== roleId));
    if (selected?.id === roleId) setSelected(null);
    showToast('success', 'Role deleted');
  }, [selected, showToast]);

  const createGroup = useCallback(async (data: {
    name: string;
    description?: string;
  }) => {
    const created = await apiClient.createGroup(data);
    setGroups(prev => [created, ...prev]);
    setSelected({ type: 'group', id: created.id });
    setActiveTab('groups');
    showToast('success', `Created group: ${created.name}`);
    return created;
  }, [showToast]);

  const updateGroup = useCallback(async (groupId: string, data: {
    name?: string;
    description?: string;
  }) => {
    const updated = await apiClient.updateGroup(groupId, data);
    setGroups(prev => prev.map(g => g.id === groupId ? updated : g));
    showToast('success', `Updated group: ${updated.name}`);
    return updated;
  }, [showToast]);

  const deleteGroup = useCallback(async (groupId: string) => {
    await apiClient.deleteGroup(groupId);
    setGroups(prev => prev.filter(g => g.id !== groupId));
    setMembersByGroup(prev => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
    if (selected?.id === groupId) setSelected(null);
    showToast('success', 'Group deleted');
  }, [selected, showToast]);

  const addMember = useCallback(async (groupId: string, roleId: string, ordinal: number) => {
    const member = await apiClient.addGroupMember(groupId, { role_id: roleId, ordinal });
    setMembersByGroup(prev => ({
      ...prev,
      [groupId]: [...(prev[groupId] ?? []), member].sort((a, b) => a.ordinal - b.ordinal),
    }));
    showToast('success', 'Member added');
    return member;
  }, [showToast]);

  const removeMember = useCallback(async (groupId: string, memberId: string) => {
    await apiClient.removeGroupMember(groupId, memberId);
    setMembersByGroup(prev => ({
      ...prev,
      [groupId]: (prev[groupId] ?? []).filter(m => m.id !== memberId),
    }));
    showToast('success', 'Member removed');
  }, [showToast]);

  const updateMember = useCallback(async (groupId: string, memberId: string, ordinal: number) => {
    const updated = await apiClient.updateGroupMember(groupId, memberId, { ordinal });
    setMembersByGroup(prev => ({
      ...prev,
      [groupId]: (prev[groupId] ?? []).map(m => m.id === memberId ? updated : m).sort((a, b) => a.ordinal - b.ordinal),
    }));
  }, []);

  // Batch operations
  const batchDelete = useCallback(async () => {
    const ids = [...checkedIds];
    if (ids.length === 0) return;
    try {
      if (activeTab === 'roles') {
        await apiClient.batchDeleteRoles(ids);
        setRoles(prev => prev.filter(r => !checkedIds.has(r.id)));
      } else {
        await apiClient.batchDeleteGroups(ids);
        setGroups(prev => prev.filter(g => !checkedIds.has(g.id)));
      }
      if (selected && checkedIds.has(selected.id)) setSelected(null);
      setCheckedIds(new Set());
      showToast('success', `Deleted ${ids.length} items`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Batch delete failed');
    }
  }, [checkedIds, activeTab, selected, showToast]);

  // Export
  const exportConfig = useCallback((type: 'roles' | 'groups' | 'all') => {
    let data: unknown;
    let filename: string;
    if (type === 'roles') {
      data = { roles };
      filename = 'roles-export.json';
    } else if (type === 'groups') {
      data = { groups };
      filename = 'groups-export.json';
    } else {
      data = { roles, groups };
      filename = 'team-config-export.json';
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', `Exported ${filename}`);
  }, [roles, groups, showToast]);

  // Import
  const importConfig = useCallback(async (jsonData: { roles?: unknown[]; groups?: unknown[] }) => {
    let importedCount = 0;
    if (jsonData.roles && Array.isArray(jsonData.roles)) {
      for (const roleData of jsonData.roles) {
        const r = roleData as Record<string, unknown>;
        try {
          await apiClient.createRole({
            name: String(r.name ?? ''),
            system_prompt: String(r.system_prompt ?? ''),
            description: r.description ? String(r.description) : undefined,
            is_lead: Boolean(r.is_lead),
            allowed_tools: Array.isArray(r.allowed_tools) ? r.allowed_tools as string[] : undefined,
            denied_tools: Array.isArray(r.denied_tools) ? r.denied_tools as string[] : undefined,
          });
          importedCount++;
        } catch (_err) {
          // skip failed items
        }
      }
    }
    if (jsonData.groups && Array.isArray(jsonData.groups)) {
      for (const groupData of jsonData.groups) {
        const g = groupData as Record<string, unknown>;
        try {
          await apiClient.createGroup({
            name: String(g.name ?? ''),
            description: g.description ? String(g.description) : undefined,
          });
          importedCount++;
        } catch (_err) {
          // skip failed items
        }
      }
    }
    await loadCatalog();
    showToast('success', `Imported ${importedCount} items`);
    return importedCount;
  }, [loadCatalog, showToast]);

  const toggleChecked = useCallback((id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearChecked = useCallback(() => {
    setCheckedIds(new Set());
  }, []);

  const selectedRole = useMemo(() => {
    if (selected?.type !== 'role') return null;
    return roles.find(r => r.id === selected.id) ?? null;
  }, [selected, roles]);

  const selectedGroup = useMemo(() => {
    if (selected?.type !== 'group') return null;
    return groups.find(g => g.id === selected.id) ?? null;
  }, [selected, groups]);

  const selectedGroupMembers = useMemo(() => {
    if (!selected || selected.type !== 'group') return [];
    return membersByGroup[selected.id] ?? [];
  }, [selected, membersByGroup]);

  return {
    // Data
    roles, groups, loading, error,
    filteredRoles, filteredGroups,
    selectedRole, selectedGroup, selectedGroupMembers,
    roleStats, groupStats, groupRuns,
    // UI state
    activeTab, setActiveTab,
    searchQuery, setSearchQuery,
    roleFilter, setRoleFilter,
    selected, setSelected,
    checkedIds, toggleChecked, clearChecked,
    toast,
    // Operations
    loadCatalog,
    createRole, updateRole, deleteRole,
    createGroup, updateGroup, deleteGroup,
    addMember, removeMember, updateMember,
    batchDelete, exportConfig, importConfig,
    showToast,
  };
}
