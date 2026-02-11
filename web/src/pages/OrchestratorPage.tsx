import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { AppShell } from '../components/Layout/AppShell';
import { useAppPreferences } from '../context/AppPreferencesContext';
import type { Group, GroupMember, GroupRunSummary, Role, Skill } from '../types';
import styles from './OrchestratorPage.module.css';

function parsePolicyEntries(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function OrchestratorPage() {
  const navigate = useNavigate();
  const { sessionKey, setSessionKey } = useAppPreferences();

  const [roles, setRoles] = useState<Role[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, GroupMember[]>>({});
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [latestGroupRun, setLatestGroupRun] = useState<GroupRunSummary | null>(null);

  const [roleName, setRoleName] = useState('');
  const [rolePrompt, setRolePrompt] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [roleIsLead, setRoleIsLead] = useState(false);
  const [roleAllowedToolsDraft, setRoleAllowedToolsDraft] = useState('');
  const [roleDeniedToolsDraft, setRoleDeniedToolsDraft] = useState('');

  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');

  const [memberRoleId, setMemberRoleId] = useState('');
  const [memberOrdinal, setMemberOrdinal] = useState(0);

  const [groupRunInput, setGroupRunInput] = useState('');
  const [groupRunSessionKey, setGroupRunSessionKey] = useState(sessionKey);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setErrorText(null);
    try {
      const [nextRoles, nextGroups, nextSkills] = await Promise.all([
        apiClient.listRoles(),
        apiClient.listGroups(),
        apiClient.listSkills(),
      ]);
      setRoles(nextRoles);
      setGroups(nextGroups);
      setSkills(nextSkills);
      setSelectedGroupId(prev => prev || nextGroups[0]?.id || '');
      setMemberRoleId(prev => prev || nextRoles[0]?.id || '');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to load orchestrator catalog');
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const loadMembers = useCallback(async (groupId: string) => {
    if (!groupId) return;
    setLoadingMembers(true);
    try {
      const members = await apiClient.listGroupMembers(groupId);
      setMembersByGroup(prev => ({
        ...prev,
        [groupId]: members,
      }));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to load members');
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedGroupId) return;
    if (membersByGroup[selectedGroupId]) return;
    void loadMembers(selectedGroupId);
  }, [selectedGroupId, membersByGroup, loadMembers]);

  const selectedMembers = useMemo(
    () => membersByGroup[selectedGroupId] ?? [],
    [membersByGroup, selectedGroupId],
  );

  const clearMessages = () => {
    setErrorText(null);
    setSuccessText(null);
  };

  const handleCreateRole = async (): Promise<void> => {
    if (!roleName.trim() || !rolePrompt.trim()) {
      setErrorText('Role name and system prompt are required.');
      return;
    }
    clearMessages();
    try {
      const allowedTools = parsePolicyEntries(roleAllowedToolsDraft);
      const deniedTools = parsePolicyEntries(roleDeniedToolsDraft);
      const created = await apiClient.createRole({
        name: roleName.trim(),
        description: roleDescription.trim() || undefined,
        system_prompt: rolePrompt.trim(),
        is_lead: roleIsLead,
        ...(allowedTools.length > 0 ? { allowed_tools: allowedTools } : {}),
        ...(deniedTools.length > 0 ? { denied_tools: deniedTools } : {}),
      });
      setRoles(prev => [created, ...prev.filter(role => role.id !== created.id)]);
      setMemberRoleId(created.id);
      setRoleName('');
      setRolePrompt('');
      setRoleDescription('');
      setRoleIsLead(false);
      setRoleAllowedToolsDraft('');
      setRoleDeniedToolsDraft('');
      setSuccessText(`Created role ${created.id}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to create role');
    }
  };

  const handleCreateGroup = async (): Promise<void> => {
    if (!groupName.trim()) {
      setErrorText('Group name is required.');
      return;
    }
    clearMessages();
    try {
      const created = await apiClient.createGroup({
        name: groupName.trim(),
        description: groupDescription.trim() || undefined,
      });
      setGroups(prev => [created, ...prev.filter(group => group.id !== created.id)]);
      setSelectedGroupId(created.id);
      setGroupName('');
      setGroupDescription('');
      setSuccessText(`Created group ${created.id}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to create group');
    }
  };

  const handleAddMember = async (): Promise<void> => {
    if (!selectedGroupId || !memberRoleId) {
      setErrorText('Select group and role first.');
      return;
    }
    clearMessages();
    try {
      const created = await apiClient.addGroupMember(selectedGroupId, {
        role_id: memberRoleId,
        ordinal: memberOrdinal,
      });
      setMembersByGroup(prev => ({
        ...prev,
        [selectedGroupId]: [
          ...(prev[selectedGroupId] ?? []),
          created,
        ].sort((a, b) => a.ordinal - b.ordinal),
      }));
      setSuccessText(`Added role ${memberRoleId} to group ${selectedGroupId}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to add member');
    }
  };

  const handleCreateGroupRun = async (): Promise<void> => {
    if (!selectedGroupId || !groupRunInput.trim()) {
      setErrorText('Group and run input are required.');
      return;
    }
    clearMessages();
    try {
      const run = await apiClient.createGroupRun(selectedGroupId, {
        input: groupRunInput.trim(),
        session_key: groupRunSessionKey.trim() || sessionKey,
      });
      setLatestGroupRun(run);
      setGroupRunInput('');
      if (groupRunSessionKey.trim()) {
        setSessionKey(groupRunSessionKey.trim());
      }
      setSuccessText(`Created group run ${run.run_id}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to create group run');
    }
  };

  return (
    <AppShell
      title="Orchestrator Studio"
      subtitle="Create roles, groups, and execute group runs"
      actions={
        <button className={styles.refreshButton} onClick={() => void loadCatalog()}>
          Reload Catalog
        </button>
      }
    >
      <div className={styles.layout}>
        <section className={styles.column}>
          <article className={styles.card}>
            <h3>Create Role</h3>
            <label className={styles.field}>
              <span>Name</span>
              <input value={roleName} onChange={e => setRoleName(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>System Prompt</span>
              <textarea
                className={styles.textarea}
                value={rolePrompt}
                onChange={e => setRolePrompt(e.target.value)}
                placeholder="Define role behavior and constraints"
              />
            </label>
            <label className={styles.field}>
              <span>Description (optional)</span>
              <input
                value={roleDescription}
                onChange={e => setRoleDescription(e.target.value)}
              />
            </label>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={roleIsLead}
                onChange={e => setRoleIsLead(e.target.checked)}
              />
              <span>Lead role (allowed to write blackboard decision)</span>
            </label>
            <label className={styles.field}>
              <span>Allowed Tools / Skills (optional)</span>
              <textarea
                className={styles.textarea}
                value={roleAllowedToolsDraft}
                onChange={e => setRoleAllowedToolsDraft(e.target.value)}
                placeholder="read_file, memory_search, skill:skill_fs"
              />
            </label>
            <label className={styles.field}>
              <span>Denied Tools / Skills (optional)</span>
              <textarea
                className={styles.textarea}
                value={roleDeniedToolsDraft}
                onChange={e => setRoleDeniedToolsDraft(e.target.value)}
                placeholder="memory_write, skill:skill_highrisk"
              />
            </label>
            <button className={styles.primaryButton} onClick={() => void handleCreateRole()}>
              Create Role
            </button>
          </article>
          <article className={styles.card}>
            <h3>Create Group</h3>
            <label className={styles.field}>
              <span>Name</span>
              <input value={groupName} onChange={e => setGroupName(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Description (optional)</span>
              <textarea
                className={styles.textarea}
                value={groupDescription}
                onChange={e => setGroupDescription(e.target.value)}
              />
            </label>
            <button className={styles.primaryButton} onClick={() => void handleCreateGroup()}>
              Create Group
            </button>
          </article>
        </section>

        <section className={styles.column}>
          <article className={styles.card}>
            <h3>Add Group Member</h3>
            <label className={styles.field}>
              <span>Group</span>
              <select
                value={selectedGroupId}
                onChange={e => setSelectedGroupId(e.target.value)}
                disabled={groups.length === 0 || loadingCatalog}
              >
                {groups.length === 0 ? (
                  <option value="">No group available</option>
                ) : (
                  groups.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name} ({group.id})
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className={styles.field}>
              <span>Role</span>
              <select
                value={memberRoleId}
                onChange={e => setMemberRoleId(e.target.value)}
                disabled={roles.length === 0 || loadingCatalog}
              >
                {roles.length === 0 ? (
                  <option value="">No role available</option>
                ) : (
                  roles.map(role => (
                    <option key={role.id} value={role.id}>
                      {role.name} ({role.id})
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className={styles.field}>
              <span>Ordinal</span>
              <input
                type="number"
                min={0}
                value={memberOrdinal}
                onChange={e => setMemberOrdinal(Number.parseInt(e.target.value || '0', 10))}
              />
            </label>
            <button className={styles.primaryButton} onClick={() => void handleAddMember()}>
              Add Member
            </button>
          </article>
          <article className={styles.card}>
            <h3>Create Group Run</h3>
            <label className={styles.field}>
              <span>Group</span>
              <select
                value={selectedGroupId}
                onChange={e => setSelectedGroupId(e.target.value)}
                disabled={groups.length === 0 || loadingCatalog}
              >
                {groups.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.name} ({group.id})
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Session Key</span>
              <input
                value={groupRunSessionKey}
                onChange={e => setGroupRunSessionKey(e.target.value)}
                placeholder={sessionKey}
              />
            </label>
            <label className={styles.field}>
              <span>Run Input</span>
              <textarea
                className={styles.textarea}
                value={groupRunInput}
                onChange={e => setGroupRunInput(e.target.value)}
                placeholder="Describe what the group should solve"
              />
            </label>
            <button className={styles.primaryButton} onClick={() => void handleCreateGroupRun()}>
              Create Group Run
            </button>
            {latestGroupRun && (
              <div className={styles.successInline}>
                <span>{latestGroupRun.run_id}</span>
                <button onClick={() => navigate(`/trace/${latestGroupRun.run_id}`)}>
                  Open Trace
                </button>
              </div>
            )}
          </article>
        </section>

        <aside className={styles.sidebar}>
          <article className={styles.card}>
            <h3>Catalog Snapshot</h3>
            <p>Roles: {roles.length}</p>
            <p>Groups: {groups.length}</p>
            <p>Skills: {skills.length}</p>
            <p>Members in selected group: {selectedMembers.length}</p>
            {loadingMembers && <p>Loading members...</p>}
            {selectedMembers.length > 0 && (
              <ul className={styles.memberList}>
                {selectedMembers.map(member => (
                  <li key={member.id}>
                    #{member.ordinal} · role {member.role_id}
                  </li>
                ))}
              </ul>
            )}
          </article>
          {errorText && <p className={styles.errorText}>{errorText}</p>}
          {successText && <p className={styles.successText}>{successText}</p>}
        </aside>
      </div>
    </AppShell>
  );
}
