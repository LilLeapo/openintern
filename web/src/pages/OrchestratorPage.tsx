import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { AppShell } from '../components/Layout/AppShell';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { useLocaleText } from '../i18n/useLocaleText';
import type { Group, GroupMember, GroupRunSummary, Role, Skill } from '../types';
import styles from './OrchestratorPage.module.css';

function parsePolicyEntries(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

function sortMembers(members: GroupMember[]): GroupMember[] {
  return [...members].sort((a, b) => a.ordinal - b.ordinal);
}

export function OrchestratorPage() {
  const navigate = useNavigate();
  const { t } = useLocaleText();
  const { tenantScope, setTenantScope, sessionKey, setSessionKey } = useAppPreferences();

  const [roles, setRoles] = useState<Role[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, GroupMember[]>>({});
  const [selectedGroupId, setSelectedGroupId] = useState('');

  const [allGroupCount, setAllGroupCount] = useState(0);
  const [unscopedGroupCount, setUnscopedGroupCount] = useState(0);

  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [syncingProject, setSyncingProject] = useState(false);

  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [latestGroupRun, setLatestGroupRun] = useState<GroupRunSummary | null>(null);

  const [scopeProjectDraft, setScopeProjectDraft] = useState(tenantScope.projectId ?? '');

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

  useEffect(() => {
    setScopeProjectDraft(tenantScope.projectId ?? '');
  }, [tenantScope.projectId]);

  const clearMessages = () => {
    setErrorText(null);
    setSuccessText(null);
  };

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setErrorText(null);
    try {
      const [nextRoles, nextSkills, scopedGroups, allGroups] = await Promise.all([
        apiClient.listRoles(),
        apiClient.listSkills(),
        apiClient.listGroups(tenantScope.projectId ?? undefined),
        apiClient.listGroups(),
      ]);
      setRoles(nextRoles);
      setSkills(nextSkills);
      setGroups(scopedGroups);
      setAllGroupCount(allGroups.length);
      setUnscopedGroupCount(allGroups.filter(group => group.project_id === null).length);
      setSelectedGroupId(prev => {
        if (prev && scopedGroups.some(group => group.id === prev)) {
          return prev;
        }
        return scopedGroups[0]?.id ?? '';
      });
      setMemberRoleId(prev => prev || nextRoles[0]?.id || '');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to load studio catalog', '加载工作台目录失败'));
    } finally {
      setLoadingCatalog(false);
    }
  }, [t, tenantScope.projectId]);

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
        [groupId]: sortMembers(members),
      }));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to load group members', '加载群组成员失败'));
    } finally {
      setLoadingMembers(false);
    }
  }, [t]);

  useEffect(() => {
    if (!selectedGroupId) return;
    if (membersByGroup[selectedGroupId]) return;
    void loadMembers(selectedGroupId);
  }, [selectedGroupId, membersByGroup, loadMembers]);

  const selectedMembers = useMemo(
    () => sortMembers(membersByGroup[selectedGroupId] ?? []),
    [membersByGroup, selectedGroupId],
  );

  const selectedGroup = useMemo(
    () => groups.find(group => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const roleNameById = useMemo(
    () => new Map(roles.map(role => [role.id, role.name])),
    [roles],
  );

  const applyScopeProject = () => {
    clearMessages();
    setTenantScope({
      orgId: tenantScope.orgId,
      userId: tenantScope.userId,
      projectId: scopeProjectDraft.trim() || null,
    });
    setSuccessText(t('Scope updated. Group catalog will refresh.', 'Scope 已更新，群组目录将刷新。'));
  };

  const bindGroupsToProject = async (includeExisting: boolean) => {
    const projectId = (tenantScope.projectId ?? '').trim();
    if (!projectId) {
      setErrorText(t('Set project_id first.', '请先设置 project_id。'));
      return;
    }

    clearMessages();
    setSyncingProject(true);
    try {
      const result = await apiClient.assignGroupsProject(projectId, { includeExisting });
      await loadCatalog();
      setSuccessText(t(
        `Updated ${result.updated} group(s) to project ${projectId}.`,
        `已将 ${result.updated} 个群组更新到项目 ${projectId}。`,
      ));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to sync group project', '同步群组项目失败'));
    } finally {
      setSyncingProject(false);
    }
  };

  const handleCreateRole = async (): Promise<void> => {
    if (!roleName.trim() || !rolePrompt.trim()) {
      setErrorText(t('Role name and system prompt are required.', '角色名称和系统提示词为必填项。'));
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
      setSuccessText(t(`Created role: ${created.name}`, `已创建角色：${created.name}`));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to create role', '创建角色失败'));
    }
  };

  const handleCreateGroup = async (): Promise<void> => {
    if (!groupName.trim()) {
      setErrorText(t('Group name is required.', '群组名称为必填项。'));
      return;
    }
    if (!tenantScope.projectId) {
      setErrorText(t('project_id is required for group creation in this studio.', '此工作台要求先设置 project_id 再创建群组。'));
      return;
    }

    clearMessages();
    try {
      const created = await apiClient.createGroup({
        name: groupName.trim(),
        description: groupDescription.trim() || undefined,
        project_id: tenantScope.projectId,
      });
      setGroups(prev => [created, ...prev.filter(group => group.id !== created.id)]);
      setAllGroupCount(prev => prev + 1);
      setSelectedGroupId(created.id);
      setGroupName('');
      setGroupDescription('');
      setSuccessText(t(`Created group: ${created.name}`, `已创建群组：${created.name}`));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to create group', '创建群组失败'));
    }
  };

  const handleAddMember = async (): Promise<void> => {
    if (!selectedGroupId || !memberRoleId) {
      setErrorText(t('Select a group and role first.', '请先选择群组和角色。'));
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
        [selectedGroupId]: sortMembers([...(prev[selectedGroupId] ?? []), created]),
      }));
      const groupNameText = groups.find(group => group.id === selectedGroupId)?.name ?? selectedGroupId;
      const roleNameText = roleNameById.get(memberRoleId) ?? memberRoleId;
      setSuccessText(t(`Added ${roleNameText} to ${groupNameText}`, `已将 ${roleNameText} 添加到 ${groupNameText}`));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to add member', '添加成员失败'));
    }
  };

  const handleMoveMember = async (memberId: string, direction: 'up' | 'down') => {
    const index = selectedMembers.findIndex(member => member.id === memberId);
    if (index < 0) return;
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= selectedMembers.length) return;

    const current = selectedMembers[index];
    const target = selectedMembers[swapIndex];
    if (!current || !target) return;

    try {
      const [updatedCurrent, updatedTarget] = await Promise.all([
        apiClient.updateGroupMember(current.group_id, current.id, { ordinal: target.ordinal }),
        apiClient.updateGroupMember(target.group_id, target.id, { ordinal: current.ordinal }),
      ]);
      setMembersByGroup(prev => ({
        ...prev,
        [selectedGroupId]: sortMembers(
          (prev[selectedGroupId] ?? []).map(member => {
            if (member.id === updatedCurrent.id) return updatedCurrent;
            if (member.id === updatedTarget.id) return updatedTarget;
            return member;
          })
        ),
      }));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to reorder members', '调整成员顺序失败'));
    }
  };

  const handleRemoveMember = async (member: GroupMember) => {
    try {
      await apiClient.removeGroupMember(member.group_id, member.id);
      setMembersByGroup(prev => ({
        ...prev,
        [member.group_id]: (prev[member.group_id] ?? []).filter(item => item.id !== member.id),
      }));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to remove member', '移除成员失败'));
    }
  };

  const handleCreateGroupRun = async (): Promise<void> => {
    if (!selectedGroupId || !groupRunInput.trim()) {
      setErrorText(t('Group and run input are required.', '群组和运行输入为必填项。'));
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
      setSuccessText(t(`Created group run ${run.run_id}`, `已创建群组运行 ${run.run_id}`));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to create group run', '创建群组运行失败'));
    }
  };

  return (
    <AppShell
      title={t('Orchestrator Studio', '编排工作台')}
      subtitle={t(
        'Use real project scope, real group catalog, and stable team-run workflow',
        '使用真实项目作用域、真实群组目录和稳定的团队运行流程',
      )}
      actions={
        <button className={styles.refreshButton} onClick={() => void loadCatalog()}>
          {t('Reload', '重新加载')}
        </button>
      }
    >
      <div className={styles.layout}>
        <section className={styles.mainColumn}>
          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <h3>{t('Scope & Group Project', 'Scope 与群组项目')}</h3>
              <span className={styles.scopeBadge}>{tenantScope.orgId} / {tenantScope.userId}</span>
            </header>
            <div className={styles.scopeGrid}>
              <label className={styles.field}>
                <span>org_id</span>
                <input value={tenantScope.orgId} disabled />
              </label>
              <label className={styles.field}>
                <span>user_id</span>
                <input value={tenantScope.userId} disabled />
              </label>
              <label className={styles.field}>
                <span>project_id</span>
                <input
                  value={scopeProjectDraft}
                  onChange={event => setScopeProjectDraft(event.target.value)}
                  placeholder={t('set a project for scoped groups', '设置项目用于群组作用域')}
                />
              </label>
            </div>
            <div className={styles.rowActions}>
              <button className={styles.primaryButton} onClick={applyScopeProject}>
                {t('Apply project_id', '应用 project_id')}
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => void bindGroupsToProject(false)}
                disabled={!tenantScope.projectId || syncingProject}
              >
                {syncingProject
                  ? t('Syncing...', '同步中...')
                  : t('Bind Null project_id Groups', '绑定空 project_id 群组')}
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => void bindGroupsToProject(true)}
                disabled={!tenantScope.projectId || syncingProject}
              >
                {t('Force All Groups to Current project_id', '强制全部群组使用当前 project_id')}
              </button>
            </div>
            <p className={styles.helperText}>
              {t(
                `Scoped groups: ${groups.length} · All groups: ${allGroupCount} · Null project_id: ${unscopedGroupCount}`,
                `当前项目群组：${groups.length} · 全部群组：${allGroupCount} · 空 project_id：${unscopedGroupCount}`,
              )}
            </p>
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <h3>{t('Create Role', '创建角色')}</h3>
            </header>
            <label className={styles.field}>
              <span>{t('Name', '名称')}</span>
              <input value={roleName} onChange={event => setRoleName(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span>{t('System Prompt', '系统提示词')}</span>
              <textarea
                className={styles.textarea}
                value={rolePrompt}
                onChange={event => setRolePrompt(event.target.value)}
                placeholder={t('Define role behavior and decision style', '定义角色行为和决策风格')}
              />
            </label>
            <label className={styles.field}>
              <span>{t('Description (optional)', '描述（可选）')}</span>
              <input value={roleDescription} onChange={event => setRoleDescription(event.target.value)} />
            </label>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={roleIsLead}
                onChange={event => setRoleIsLead(event.target.checked)}
              />
              <span>{t('Lead role (can synthesize final answer)', 'Lead 角色（可综合最终结论）')}</span>
            </label>
            <div className={styles.rowGrid}>
              <label className={styles.field}>
                <span>{t('Allowed Tools', '允许工具')}</span>
                <textarea
                  className={styles.textarea}
                  value={roleAllowedToolsDraft}
                  onChange={event => setRoleAllowedToolsDraft(event.target.value)}
                  placeholder="read_file, memory_search"
                />
              </label>
              <label className={styles.field}>
                <span>{t('Denied Tools', '禁用工具')}</span>
                <textarea
                  className={styles.textarea}
                  value={roleDeniedToolsDraft}
                  onChange={event => setRoleDeniedToolsDraft(event.target.value)}
                  placeholder="exec_shell, memory_write"
                />
              </label>
            </div>
            <button className={styles.primaryButton} onClick={() => void handleCreateRole()}>
              {t('Create Role', '创建角色')}
            </button>
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <h3>{t('Create Group', '创建群组')}</h3>
            </header>
            <label className={styles.field}>
              <span>{t('Name', '名称')}</span>
              <input value={groupName} onChange={event => setGroupName(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span>{t('Description (optional)', '描述（可选）')}</span>
              <textarea
                className={styles.textarea}
                value={groupDescription}
                onChange={event => setGroupDescription(event.target.value)}
              />
            </label>
            <p className={styles.helperText}>
              {t(
                `Group project_id will be: ${tenantScope.projectId ?? 'null (please set before create)'}`,
                `群组将使用 project_id：${tenantScope.projectId ?? 'null（请先设置）'}`,
              )}
            </p>
            <button className={styles.primaryButton} onClick={() => void handleCreateGroup()}>
              {t('Create Group', '创建群组')}
            </button>
          </article>
        </section>

        <section className={styles.mainColumn}>
          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <h3>{t('Add Group Member', '添加群组成员')}</h3>
            </header>
            <div className={styles.rowGrid}>
              <label className={styles.field}>
                <span>{t('Group', '群组')}</span>
                <select
                  value={selectedGroupId}
                  onChange={event => setSelectedGroupId(event.target.value)}
                  disabled={groups.length === 0 || loadingCatalog}
                >
                  {groups.length === 0 ? (
                    <option value="">{t('No group in current project', '当前项目暂无群组')}</option>
                  ) : (
                    groups.map(group => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))
                  )}
                </select>
              </label>
              <label className={styles.field}>
                <span>{t('Role', '角色')}</span>
                <select
                  value={memberRoleId}
                  onChange={event => setMemberRoleId(event.target.value)}
                  disabled={roles.length === 0 || loadingCatalog}
                >
                  {roles.length === 0 ? (
                    <option value="">{t('No role', '暂无角色')}</option>
                  ) : (
                    roles.map(role => (
                      <option key={role.id} value={role.id}>{role.name}</option>
                    ))
                  )}
                </select>
              </label>
              <label className={styles.field}>
                <span>{t('Ordinal', '顺位')}</span>
                <input
                  type="number"
                  min={0}
                  value={memberOrdinal}
                  onChange={event => setMemberOrdinal(Number.parseInt(event.target.value || '0', 10))}
                />
              </label>
            </div>
            <button className={styles.primaryButton} onClick={() => void handleAddMember()}>
              {t('Add Member', '添加成员')}
            </button>

            <div className={styles.memberList}>
              {selectedMembers.map((member, index) => (
                <article key={member.id} className={styles.memberItem}>
                  <div>
                    <strong>{roleNameById.get(member.role_id) ?? member.role_id}</strong>
                    <p>{t(`ordinal ${member.ordinal}`, `顺位 ${member.ordinal}`)}</p>
                    {index === 0 && <em>{t('Dispatcher candidate', '调度候选')}</em>}
                  </div>
                  <div className={styles.rowActions}>
                    <button onClick={() => void handleMoveMember(member.id, 'up')}>↑</button>
                    <button onClick={() => void handleMoveMember(member.id, 'down')}>↓</button>
                    <button onClick={() => void handleRemoveMember(member)}>
                      {t('Remove', '移除')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {loadingMembers && <p className={styles.helperText}>{t('Loading members...', '正在加载成员...')}</p>}
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <h3>{t('Create Group Run', '创建群组运行')}</h3>
            </header>
            <label className={styles.field}>
              <span>{t('Group', '群组')}</span>
              <select
                value={selectedGroupId}
                onChange={event => setSelectedGroupId(event.target.value)}
                disabled={groups.length === 0 || loadingCatalog}
              >
                {groups.map(group => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>{t('Session Key', '会话 Key')}</span>
              <input
                value={groupRunSessionKey}
                onChange={event => setGroupRunSessionKey(event.target.value)}
                placeholder={sessionKey}
              />
            </label>
            <label className={styles.field}>
              <span>{t('Run Input', '运行输入')}</span>
              <textarea
                className={styles.textarea}
                value={groupRunInput}
                onChange={event => setGroupRunInput(event.target.value)}
                placeholder={t('Describe the task for this group', '描述要让该群组执行的任务')}
              />
            </label>
            <button className={styles.primaryButton} onClick={() => void handleCreateGroupRun()}>
              {t('Create Group Run', '创建群组运行')}
            </button>
            {latestGroupRun && (
              <div className={styles.successInline}>
                <span>{t(`Created group run ${latestGroupRun.run_id}`, `已创建群组运行 ${latestGroupRun.run_id}`)}</span>
                <button onClick={() => navigate(`/trace/${latestGroupRun.run_id}`)}>
                  {t('Open Trace', '打开追踪')}
                </button>
              </div>
            )}
          </article>
        </section>

        <aside className={styles.sideColumn}>
          <article className={styles.card}>
            <h3>{t('Workspace Snapshot', '工作台概览')}</h3>
            <p>{t(`Roles: ${roles.length}`, `角色：${roles.length}`)}</p>
            <p>{t(`Groups in project: ${groups.length}`, `项目内群组：${groups.length}`)}</p>
            <p>{t(`All groups: ${allGroupCount}`, `全部群组：${allGroupCount}`)}</p>
            <p>{t(`Null project_id groups: ${unscopedGroupCount}`, `空 project_id 群组：${unscopedGroupCount}`)}</p>
            <p>{t(`Skills: ${skills.length}`, `技能：${skills.length}`)}</p>
            {selectedGroup && (
              <>
                <hr className={styles.divider} />
                <p><strong>{selectedGroup.name}</strong></p>
                <p>{t(`project_id: ${selectedGroup.project_id ?? 'null'}`, `project_id：${selectedGroup.project_id ?? 'null'}`)}</p>
                <p>{selectedGroup.description || t('No description', '无描述')}</p>
              </>
            )}
          </article>

          {errorText && <p className={styles.errorText}>{errorText}</p>}
          {successText && <p className={styles.successText}>{successText}</p>}
        </aside>
      </div>
    </AppShell>
  );
}
