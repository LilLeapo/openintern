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
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function OrchestratorPage() {
  const navigate = useNavigate();
  const { sessionKey, setSessionKey } = useAppPreferences();
  const { t } = useLocaleText();

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
      setErrorText(error instanceof Error ? error.message : t('Failed to load studio catalog', '加载工作台目录失败'));
    } finally {
      setLoadingCatalog(false);
    }
  }, [t]);

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
      setErrorText(error instanceof Error ? error.message : t('Failed to load team experts', '加载团队专家失败'));
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
    () => membersByGroup[selectedGroupId] ?? [],
    [membersByGroup, selectedGroupId],
  );
  const roleNameById = useMemo(
    () => new Map(roles.map(role => [role.id, role.name])),
    [roles],
  );

  const clearMessages = () => {
    setErrorText(null);
    setSuccessText(null);
  };

  const handleCreateRole = async (): Promise<void> => {
    if (!roleName.trim() || !rolePrompt.trim()) {
      setErrorText(t('Expert name and instructions are required.', '专家名称和说明为必填。'));
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
      setSuccessText(t(`Created expert profile: ${created.name}`, `已创建专家画像：${created.name}`));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to create expert profile', '创建专家画像失败'));
    }
  };

  const handleCreateGroup = async (): Promise<void> => {
    if (!groupName.trim()) {
      setErrorText(t('Team name is required.', '团队名称为必填。'));
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
      setSuccessText(t(`Created assistant team: ${created.name}`, `已创建助手团队：${created.name}`));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to create assistant team', '创建助手团队失败'));
    }
  };

  const handleAddMember = async (): Promise<void> => {
    if (!selectedGroupId || !memberRoleId) {
      setErrorText(t('Select a team and expert profile first.', '请先选择团队和专家画像。'));
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
      const teamName = groups.find(group => group.id === selectedGroupId)?.name ?? selectedGroupId;
      const roleName = roleNameById.get(memberRoleId) ?? memberRoleId;
      setSuccessText(t(`Added ${roleName} to ${teamName}`, `已将 ${roleName} 添加到 ${teamName}`));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to add expert to team', '添加专家到团队失败'));
    }
  };

  const handleCreateGroupRun = async (): Promise<void> => {
    if (!selectedGroupId || !groupRunInput.trim()) {
      setErrorText(t('Team and task are required.', '团队和任务内容为必填。'));
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
      setSuccessText(t(`Started team run ${run.run_id}`, `已启动团队运行 ${run.run_id}`));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to start team run', '启动团队运行失败'));
    }
  };

  return (
    <AppShell
      title={t('Team Studio', '团队工作台')}
      subtitle={t(
        'Build expert profiles, assemble teams, and test team runs',
        '构建专家画像、组建团队并测试团队运行',
      )}
      actions={
        <button className={styles.refreshButton} onClick={() => void loadCatalog()}>
          {t('Reload', '重新加载')}
        </button>
      }
    >
      <div className={styles.layout}>
        <section className={styles.column}>
          <article className={styles.card}>
            <h3>{t('Create Expert Profile', '创建专家画像')}</h3>
            <label className={styles.field}>
              <span>{t('Name', '名称')}</span>
              <input value={roleName} onChange={e => setRoleName(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>{t('Instructions', '说明')}</span>
              <textarea
                className={styles.textarea}
                value={rolePrompt}
                onChange={e => setRolePrompt(e.target.value)}
                placeholder={t(
                  'Define how this expert should reason and respond',
                  '定义这个专家应如何思考和响应',
                )}
              />
            </label>
            <label className={styles.field}>
              <span>{t('Description (optional)', '描述（可选）')}</span>
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
              <span>{t('Team lead (produces final synthesized decision)', '团队负责人（输出最终综合结论）')}</span>
            </label>
            <label className={styles.field}>
              <span>{t('Allowed Capabilities (optional)', '允许能力（可选）')}</span>
              <textarea
                className={styles.textarea}
                value={roleAllowedToolsDraft}
                onChange={e => setRoleAllowedToolsDraft(e.target.value)}
                placeholder="read_file, memory_search, skill:skill_fs"
              />
            </label>
            <label className={styles.field}>
              <span>{t('Blocked Capabilities (optional)', '禁用能力（可选）')}</span>
              <textarea
                className={styles.textarea}
                value={roleDeniedToolsDraft}
                onChange={e => setRoleDeniedToolsDraft(e.target.value)}
                placeholder="memory_write, skill:skill_highrisk"
              />
            </label>
            <button className={styles.primaryButton} onClick={() => void handleCreateRole()}>
              {t('Create Expert', '创建专家')}
            </button>
          </article>
          <article className={styles.card}>
            <h3>{t('Create Assistant Team', '创建助手团队')}</h3>
            <label className={styles.field}>
              <span>{t('Name', '名称')}</span>
              <input value={groupName} onChange={e => setGroupName(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>{t('Description (optional)', '描述（可选）')}</span>
              <textarea
                className={styles.textarea}
                value={groupDescription}
                onChange={e => setGroupDescription(e.target.value)}
              />
            </label>
            <button className={styles.primaryButton} onClick={() => void handleCreateGroup()}>
              {t('Create Team', '创建团队')}
            </button>
          </article>
        </section>

        <section className={styles.column}>
          <article className={styles.card}>
            <h3>{t('Add Expert to Team', '将专家加入团队')}</h3>
            <label className={styles.field}>
              <span>{t('Team', '团队')}</span>
              <select
                value={selectedGroupId}
                onChange={e => setSelectedGroupId(e.target.value)}
                disabled={groups.length === 0 || loadingCatalog}
              >
                {groups.length === 0 ? (
                  <option value="">{t('No team available', '没有可用团队')}</option>
                ) : (
                  groups.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className={styles.field}>
              <span>{t('Expert Profile', '专家画像')}</span>
              <select
                value={memberRoleId}
                onChange={e => setMemberRoleId(e.target.value)}
                disabled={roles.length === 0 || loadingCatalog}
              >
                {roles.length === 0 ? (
                  <option value="">{t('No expert profile available', '没有可用专家画像')}</option>
                ) : (
                  roles.map(role => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className={styles.field}>
              <span>{t('Turn Priority', '轮次优先级')}</span>
              <input
                type="number"
                min={0}
                value={memberOrdinal}
                onChange={e => setMemberOrdinal(Number.parseInt(e.target.value || '0', 10))}
              />
            </label>
            <button className={styles.primaryButton} onClick={() => void handleAddMember()}>
              {t('Add Expert', '添加专家')}
            </button>
          </article>
          <article className={styles.card}>
            <h3>{t('Test Team Run', '测试团队运行')}</h3>
            <label className={styles.field}>
              <span>{t('Team', '团队')}</span>
              <select
                value={selectedGroupId}
                onChange={e => setSelectedGroupId(e.target.value)}
                disabled={groups.length === 0 || loadingCatalog}
              >
                {groups.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>{t('Conversation ID', '会话 ID')}</span>
              <input
                value={groupRunSessionKey}
                onChange={e => setGroupRunSessionKey(e.target.value)}
                placeholder={sessionKey}
              />
            </label>
            <label className={styles.field}>
              <span>{t('Task', '任务')}</span>
              <textarea
                className={styles.textarea}
                value={groupRunInput}
                onChange={e => setGroupRunInput(e.target.value)}
                placeholder={t(
                  'Describe what this team should solve',
                  '描述这个团队需要解决的问题',
                )}
              />
            </label>
            <button className={styles.primaryButton} onClick={() => void handleCreateGroupRun()}>
              {t('Start Team Run', '启动团队运行')}
            </button>
            {latestGroupRun && (
              <div className={styles.successInline}>
                <span>{latestGroupRun.run_id}</span>
                <button onClick={() => navigate(`/trace/${latestGroupRun.run_id}`)}>
                  {t('Open Details', '查看详情')}
                </button>
              </div>
            )}
          </article>
        </section>

        <aside className={styles.sidebar}>
          <article className={styles.card}>
            <h3>{t('Studio Snapshot', '工作台概览')}</h3>
            <p>{t(`Expert Profiles: ${roles.length}`, `专家画像：${roles.length}`)}</p>
            <p>{t(`Assistant Teams: ${groups.length}`, `助手团队：${groups.length}`)}</p>
            <p>{t(`Skills: ${skills.length}`, `技能：${skills.length}`)}</p>
            <p>{t(`Experts in selected team: ${selectedMembers.length}`, `所选团队专家数：${selectedMembers.length}`)}</p>
            {loadingMembers && <p>{t('Loading experts...', '加载专家中...')}</p>}
            {selectedMembers.length > 0 && (
              <ul className={styles.memberList}>
                {selectedMembers.map(member => (
                  <li key={member.id}>
                    #{member.ordinal} · {roleNameById.get(member.role_id) ?? member.role_id}
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
