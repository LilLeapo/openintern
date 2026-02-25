import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/Layout/AppShell';
import { apiClient } from '../api/client';
import { useLocaleText } from '../i18n/useLocaleText';
import { useTeamManagement } from '../hooks/useTeamManagement';
import type { Skill } from '../types';
import styles from './TeamManagementPage.module.css';

const BUILTIN_CAPABILITIES = [
  'read_file',
  'write_file',
  'glob_files',
  'grep_files',
  'memory_search',
  'memory_write',
  'handoff_to',
  'dispatch_subtasks',
  'exec_shell',
];

type StudioTab = 'roles' | 'groups';

export function TeamManagementPage() {
  const { t } = useLocaleText();
  const {
    roles,
    groups,
    selected,
    setSelected,
    selectedRole,
    selectedGroup,
    selectedGroupMembers,
    createRole,
    updateRole,
    deleteRole,
    createGroup,
    deleteGroup,
    addMember,
    removeMember,
    updateMember,
    toast,
    showToast,
  } = useTeamManagement();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [tab, setTab] = useState<StudioTab>('roles');
  const [roleForm, setRoleForm] = useState({
    name: '',
    description: '',
    systemPrompt: '',
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.4,
    isLead: false,
  });
  const [assignedCapabilities, setAssignedCapabilities] = useState<string[]>([]);
  const [groupFormName, setGroupFormName] = useState('');
  const [groupFormDesc, setGroupFormDesc] = useState('');
  const [memberRoleId, setMemberRoleId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadSkills = async () => {
      try {
        const data = await apiClient.listSkills();
        setSkills(data);
      } catch {
        setSkills([]);
      }
    };
    void loadSkills();
  }, []);

  useEffect(() => {
    if (!selectedRole) {
      return;
    }
    const llmConfig = (selectedRole.style_constraints?.['llm'] ?? {}) as Record<string, unknown>;
    setRoleForm({
      name: selectedRole.name,
      description: selectedRole.description,
      systemPrompt: selectedRole.system_prompt,
      provider: String(llmConfig['provider'] ?? 'openai'),
      model: String(llmConfig['model'] ?? 'gpt-4o-mini'),
      temperature: Number(llmConfig['temperature'] ?? 0.4),
      isLead: selectedRole.is_lead,
    });
    setAssignedCapabilities(selectedRole.allowed_tools ?? []);
  }, [selectedRole]);

  useEffect(() => {
    setMemberRoleId(prev => prev || roles[0]?.id || '');
  }, [roles]);

  const capabilityCatalog = useMemo(() => {
    const skillCapabilities = skills.map(skill => `skill:${skill.id}`);
    return [...BUILTIN_CAPABILITIES, ...skillCapabilities];
  }, [skills]);

  const availableCapabilities = useMemo(
    () => capabilityCatalog.filter(item => !assignedCapabilities.includes(item)),
    [assignedCapabilities, capabilityCatalog],
  );

  const roleNameById = useMemo(
    () => Object.fromEntries(roles.map(role => [role.id, role.name])),
    [roles],
  );

  const normalizedMembers = useMemo(
    () => [...selectedGroupMembers].sort((a, b) => a.ordinal - b.ordinal),
    [selectedGroupMembers],
  );

  const resetRoleForm = () => {
    setRoleForm({
      name: '',
      description: '',
      systemPrompt: '',
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.4,
      isLead: false,
    });
    setAssignedCapabilities([]);
  };

  const saveRole = async () => {
    if (!roleForm.name.trim() || !roleForm.systemPrompt.trim()) {
      showToast('error', t('Role name and system prompt are required.', '角色名称与系统提示词必填。'));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: roleForm.name.trim(),
        description: roleForm.description.trim(),
        system_prompt: roleForm.systemPrompt.trim(),
        is_lead: roleForm.isLead,
        allowed_tools: assignedCapabilities,
        style_constraints: {
          llm: {
            provider: roleForm.provider,
            model: roleForm.model,
            temperature: roleForm.temperature,
          },
        },
      };

      if (selectedRole) {
        await updateRole(selectedRole.id, payload);
      } else {
        await createRole(payload);
      }
      showToast('success', t('Role saved', '角色已保存'));
      if (!selectedRole) {
        resetRoleForm();
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('Failed to save role', '保存角色失败'));
    } finally {
      setSaving(false);
    }
  };

  const createNewGroup = async () => {
    if (!groupFormName.trim()) {
      showToast('error', t('Group name is required.', '群组名称必填。'));
      return;
    }
    try {
      await createGroup({
        name: groupFormName.trim(),
        description: groupFormDesc.trim() || undefined,
      });
      setGroupFormName('');
      setGroupFormDesc('');
      setTab('groups');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('Failed to create group', '创建群组失败'));
    }
  };

  const assignMember = async () => {
    if (!selectedGroup || !memberRoleId) {
      showToast('error', t('Select group and role first.', '请先选择群组与角色。'));
      return;
    }
    try {
      const nextOrdinal = normalizedMembers.length === 0
        ? 0
        : Math.max(...normalizedMembers.map(member => member.ordinal)) + 1;
      await addMember(selectedGroup.id, memberRoleId, nextOrdinal);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('Failed to add member', '添加成员失败'));
    }
  };

  const moveMember = async (memberId: string, direction: 'up' | 'down') => {
    const index = normalizedMembers.findIndex(member => member.id === memberId);
    if (index < 0) return;
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= normalizedMembers.length) return;

    const current = normalizedMembers[index]!;
    const target = normalizedMembers[swapIndex]!;
    await Promise.all([
      updateMember(current.group_id, current.id, target.ordinal),
      updateMember(target.group_id, target.id, current.ordinal),
    ]);
  };

  const setDispatcher = async (memberId: string) => {
    const target = normalizedMembers.find(member => member.id === memberId);
    if (!target) return;
    await Promise.all(
      normalizedMembers.map((member, index) => updateMember(
        member.group_id,
        member.id,
        member.id === memberId ? 0 : index + 1,
      )),
    );
  };

  const selectedRoleId = selected?.type === 'role' ? selected.id : null;
  const selectedGroupId = selected?.type === 'group' ? selected.id : null;

  return (
    <AppShell
      title={t('Swarm & Skill Orchestration', '团队与能力编排')}
      subtitle={t(
        'Define roles, mount capabilities, and orchestrate group topology',
        '定义角色基因、能力挂载与群组拓扑',
      )}
    >
      <div className={styles.layout}>
        <section className={styles.listPanel}>
          <div className={styles.tabs}>
            <button
              className={tab === 'roles' ? styles.tabActive : styles.tab}
              onClick={() => setTab('roles')}
            >
              {t('Roles', '角色')} ({roles.length})
            </button>
            <button
              className={tab === 'groups' ? styles.tabActive : styles.tab}
              onClick={() => setTab('groups')}
            >
              {t('Groups', '群组')} ({groups.length})
            </button>
          </div>
          <div className={styles.list}>
            {tab === 'roles' && roles.map(role => (
              <button
                key={role.id}
                className={selectedRoleId === role.id ? styles.itemActive : styles.item}
                onClick={() => setSelected({ type: 'role', id: role.id })}
              >
                <strong>{role.name}</strong>
                <span>{role.is_lead ? t('Dispatcher candidate', '可做调度员') : role.id}</span>
              </button>
            ))}
            {tab === 'groups' && groups.map(group => (
              <button
                key={group.id}
                className={selectedGroupId === group.id ? styles.itemActive : styles.item}
                onClick={() => setSelected({ type: 'group', id: group.id })}
              >
                <strong>{group.name}</strong>
                <span>{group.description || group.id}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.mainPanel}>
          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <h3>{t('Role Management', '角色管理')}</h3>
              <div className={styles.rowActions}>
                {selectedRole && (
                  <button className={styles.dangerButton} onClick={() => void deleteRole(selectedRole.id)}>
                    {t('Delete Role', '删除角色')}
                  </button>
                )}
                <button className={styles.secondaryButton} onClick={resetRoleForm}>
                  {t('New Role', '新建角色')}
                </button>
              </div>
            </header>

            <div className={styles.formGrid}>
              <label>
                <span>{t('Name', '名称')}</span>
                <input
                  value={roleForm.name}
                  onChange={event => setRoleForm(prev => ({ ...prev, name: event.target.value }))}
                />
              </label>
              <label>
                <span>{t('Model Provider', '模型 Provider')}</span>
                <select
                  value={roleForm.provider}
                  onChange={event => setRoleForm(prev => ({ ...prev, provider: event.target.value }))}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Claude</option>
                  <option value="gemini">Gemini</option>
                </select>
              </label>
              <label>
                <span>{t('Model', '模型')}</span>
                <input
                  value={roleForm.model}
                  onChange={event => setRoleForm(prev => ({ ...prev, model: event.target.value }))}
                />
              </label>
              <label>
                <span>{t('Temperature', '温度')}</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={2}
                  value={roleForm.temperature}
                  onChange={event => setRoleForm(prev => ({ ...prev, temperature: Number.parseFloat(event.target.value) || 0 }))}
                />
              </label>
            </div>

            <label className={styles.fullWidth}>
              <span>{t('Description', '描述')}</span>
              <input
                value={roleForm.description}
                onChange={event => setRoleForm(prev => ({ ...prev, description: event.target.value }))}
              />
            </label>

            <label className={styles.fullWidth}>
              <span>{t('System Prompt', '系统提示词')}</span>
              <textarea
                value={roleForm.systemPrompt}
                onChange={event => setRoleForm(prev => ({ ...prev, systemPrompt: event.target.value }))}
              />
            </label>

            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={roleForm.isLead}
                onChange={event => setRoleForm(prev => ({ ...prev, isLead: event.target.checked }))}
              />
              <span>{t('Mark as Dispatcher/Leader', '设为调度员 / Leader')}</span>
            </label>

            <div className={styles.transferSection}>
              <h4>{t('Capability Mount (Tools + Skills)', '能力挂载（工具 + 技能）')}</h4>
              <div className={styles.transferGrid}>
                <div className={styles.transferList}>
                  <header>{t('Available', '可选')}</header>
                  {availableCapabilities.map(cap => (
                    <button
                      key={cap}
                      className={styles.transferItem}
                      onClick={() => setAssignedCapabilities(prev => [...prev, cap])}
                    >
                      + {cap}
                    </button>
                  ))}
                </div>
                <div className={styles.transferList}>
                  <header>{t('Assigned', '已挂载')}</header>
                  {assignedCapabilities.map(cap => (
                    <button
                      key={cap}
                      className={styles.transferItemActive}
                      onClick={() => setAssignedCapabilities(prev => prev.filter(item => item !== cap))}
                    >
                      - {cap}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button className={styles.primaryButton} onClick={() => void saveRole()} disabled={saving}>
              {saving ? t('Saving...', '保存中...') : t('Save Role', '保存角色')}
            </button>
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <h3>{t('Group Management', '群组管理')}</h3>
              {selectedGroup && (
                <button className={styles.dangerButton} onClick={() => void deleteGroup(selectedGroup.id)}>
                  {t('Delete Group', '删除群组')}
                </button>
              )}
            </header>

            <div className={styles.formGrid}>
              <label>
                <span>{t('Group Name', '群组名称')}</span>
                <input value={groupFormName} onChange={event => setGroupFormName(event.target.value)} />
              </label>
              <label>
                <span>{t('Description', '描述')}</span>
                <input value={groupFormDesc} onChange={event => setGroupFormDesc(event.target.value)} />
              </label>
            </div>
            <button className={styles.secondaryButton} onClick={() => void createNewGroup()}>
              {t('Create Group', '创建群组')}
            </button>

            {selectedGroup && (
              <>
                <div className={styles.memberToolbar}>
                  <select value={memberRoleId} onChange={event => setMemberRoleId(event.target.value)}>
                    {roles.map(role => (
                      <option key={role.id} value={role.id}>{role.name}</option>
                    ))}
                  </select>
                  <button className={styles.primaryButton} onClick={() => void assignMember()}>
                    {t('Add Member', '添加成员')}
                  </button>
                </div>

                <div className={styles.memberList}>
                  {normalizedMembers.map((member, index) => (
                    <article key={member.id} className={styles.memberCard}>
                      <div>
                        <strong>{roleNameById[member.role_id] ?? member.role_id}</strong>
                        <p>
                          {index === 0
                            ? t('Dispatcher', '调度员')
                            : t(`Ordinal ${member.ordinal}`, `顺位 ${member.ordinal}`)}
                        </p>
                      </div>
                      <div className={styles.rowActions}>
                        <button onClick={() => void moveMember(member.id, 'up')}>↑</button>
                        <button onClick={() => void moveMember(member.id, 'down')}>↓</button>
                        <button onClick={() => void setDispatcher(member.id)}>
                          {t('Set Dispatcher', '设为调度')}
                        </button>
                        <button onClick={() => void removeMember(member.group_id, member.id)}>
                          {t('Remove', '移除')}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </article>
        </section>
      </div>

      {toast && (
        <div className={toast.type === 'success' ? styles.toastSuccess : styles.toastError}>
          {toast.message}
        </div>
      )}
    </AppShell>
  );
}
