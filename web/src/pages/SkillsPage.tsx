import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { AppShell } from '../components/Layout/AppShell';
import type { Skill, SkillProvider, SkillRiskLevel } from '../types';
import { useLocaleText } from '../i18n/useLocaleText';
import styles from './SkillsPage.module.css';

const SKILL_ENABLED_STORAGE = 'openintern.skill_enabled_map.v1';

function parseToolsInput(input: string): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [namePart, ...descParts] = line.split('|');
      const name = namePart?.trim() ?? '';
      const description = descParts.join('|').trim();
      return {
        name,
        description,
        parameters: {
          type: 'object',
          properties: {},
        },
      };
    })
    .filter((tool) => tool.name.length > 0);
}

function readEnabledMap(): Record<string, boolean> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(SKILL_ENABLED_STORAGE);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function SkillsPage() {
  const { t } = useLocaleText();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<'all' | SkillProvider>('all');
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>(readEnabledMap);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState<SkillProvider>('builtin');
  const [riskLevel, setRiskLevel] = useState<SkillRiskLevel>('low');
  const [toolsDraft, setToolsDraft] = useState('');

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const data = await apiClient.listSkills();
      setSkills(data);
      setEnabledMap(prev => {
        const next = { ...prev };
        data.forEach((skill) => {
          if (next[skill.id] === undefined) {
            next[skill.id] = true;
          }
        });
        return next;
      });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to load skills', '加载技能失败'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SKILL_ENABLED_STORAGE, JSON.stringify(enabledMap));
  }, [enabledMap]);

  const clearMessages = () => {
    setErrorText(null);
    setSuccessText(null);
  };

  const handleCreateSkill = async (): Promise<void> => {
    if (!name.trim()) {
      setErrorText(t('Skill name is required.', '技能名称为必填。'));
      return;
    }
    clearMessages();
    setSaving(true);
    try {
      const tools = parseToolsInput(toolsDraft);
      const created = await apiClient.createSkill({
        name: name.trim(),
        description: description.trim() || undefined,
        provider,
        risk_level: riskLevel,
        tools,
      });
      setSkills((prev) => [created, ...prev.filter((skill) => skill.id !== created.id)]);
      setEnabledMap(prev => ({ ...prev, [created.id]: true }));
      setName('');
      setDescription('');
      setToolsDraft('');
      setSuccessText(t(`Created skill ${created.id}`, `已创建技能 ${created.id}`));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to create skill', '创建技能失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSkill = async (skillId: string): Promise<void> => {
    clearMessages();
    try {
      await apiClient.deleteSkill(skillId);
      setSkills((prev) => prev.filter((skill) => skill.id !== skillId));
      setSuccessText(t(`Deleted skill ${skillId}`, `已删除技能 ${skillId}`));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to delete skill', '删除技能失败'));
    }
  };

  const visibleSkills = useMemo(() => {
    if (providerFilter === 'all') return skills;
    return skills.filter(skill => skill.provider === providerFilter);
  }, [providerFilter, skills]);

  const totalTools = useMemo(
    () => skills.reduce((count, skill) => count + skill.tools.length, 0),
    [skills],
  );

  const enabledCount = useMemo(
    () => skills.filter(skill => enabledMap[skill.id] !== false).length,
    [enabledMap, skills],
  );

  return (
    <AppShell
      title={t('Skill / Plugin Registry', 'Skill / Plugin 注册表')}
      subtitle={t(
        'Inspect schemas, manage health toggles, and maintain MCP/builtin catalog',
        '查看参数 Schema、管理启停开关、维护 MCP/内置能力目录',
      )}
      actions={
        <button className={styles.refreshButton} onClick={() => void loadSkills()}>
          {t('Reload Registry', '刷新注册表')}
        </button>
      }
    >
      <div className={styles.layout}>
        <section className={styles.editorColumn}>
          <article className={styles.card}>
            <h3>{t('Register Skill', '注册技能')}</h3>
            <label className={styles.field}>
              <span>{t('Name', '名称')}</span>
              <input
                aria-label={t('Skill Name', '技能名称')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('Knowledge Retrieval', '知识检索')}
              />
            </label>
            <label className={styles.field}>
              <span>{t('Description', '描述')}</span>
              <input
                aria-label={t('Description', '描述')}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('When to use and constraints', '使用场景与约束')}
              />
            </label>
            <div className={styles.inlineFields}>
              <label className={styles.field}>
                <span>{t('Provider', 'Provider')}</span>
                <select
                  aria-label={t('Provider', 'Provider')}
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as SkillProvider)}
                >
                  <option value="builtin">builtin</option>
                  <option value="mcp">mcp</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>{t('Risk Level', '风险级别')}</span>
                <select
                  aria-label={t('Risk Level', '风险级别')}
                  value={riskLevel}
                  onChange={(event) => setRiskLevel(event.target.value as SkillRiskLevel)}
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
            </div>
            <label className={styles.field}>
              <span>{t('Tools (name|description)', '工具（name|description）')}</span>
              <textarea
                aria-label={t('Tools', '工具')}
                className={styles.textarea}
                value={toolsDraft}
                onChange={(event) => setToolsDraft(event.target.value)}
                placeholder={t(
                  'memory_search|semantic memory lookup\nread_file|read UTF-8 file',
                  'memory_search|语义记忆检索\nread_file|读取 UTF-8 文件',
                )}
              />
            </label>
            <button
              className={styles.primaryButton}
              onClick={() => void handleCreateSkill()}
              disabled={saving}
            >
              {saving ? t('Creating...', '创建中...') : t('Create Skill', '创建技能')}
            </button>
          </article>
          {errorText && <p className={styles.errorText}>{errorText}</p>}
          {successText && <p className={styles.successText}>{successText}</p>}
        </section>

        <section className={styles.listColumn}>
          <article className={styles.card}>
            <h3>{t('Registry Snapshot', '注册表概览')}</h3>
            <p>{t(`Total skills: ${skills.length}`, `技能总数：${skills.length}`)}</p>
            <p>{t(`Enabled: ${enabledCount}`, `启用中：${enabledCount}`)}</p>
            <p>{t(`Total tool refs: ${totalTools}`, `工具引用总数：${totalTools}`)}</p>
            <div className={styles.inlineFields}>
              <label className={styles.field}>
                <span>{t('Provider filter', 'Provider 筛选')}</span>
                <select
                  value={providerFilter}
                  onChange={event => setProviderFilter(event.target.value as 'all' | SkillProvider)}
                >
                  <option value="all">all</option>
                  <option value="builtin">builtin</option>
                  <option value="mcp">mcp</option>
                </select>
              </label>
            </div>
            {loading && <p>{t('Loading skills...', '加载技能中...')}</p>}
          </article>

          {visibleSkills.map((skill) => {
            const enabled = enabledMap[skill.id] !== false;
            return (
              <article key={skill.id} className={styles.card}>
                <header className={styles.skillHeader}>
                  <div>
                    <h4>{skill.name}</h4>
                    <p className={styles.skillId}>{skill.id}</p>
                  </div>
                  <div className={styles.skillActions}>
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={event => setEnabledMap(prev => ({ ...prev, [skill.id]: event.target.checked }))}
                      />
                      <span>{enabled ? t('Enabled', '已启用') : t('Disabled', '已禁用')}</span>
                    </label>
                    <button
                      className={styles.deleteButton}
                      onClick={() => void handleDeleteSkill(skill.id)}
                    >
                      {t('Delete', '删除')}
                    </button>
                  </div>
                </header>
                <p className={styles.metaLine}>
                  {t(
                    `provider=${skill.provider} · risk=${skill.risk_level} · health=${skill.health_status}`,
                    `provider=${skill.provider} · 风险=${skill.risk_level} · 健康=${skill.health_status}`,
                  )}
                </p>
                {skill.description && <p className={styles.description}>{skill.description}</p>}
                <div>
                  <p className={styles.metaLabel}>{t('Schema Preview', 'Schema 预览')}</p>
                  {skill.tools.length === 0 ? (
                    <p className={styles.emptyTools}>{t('No tools bound', '没有绑定工具')}</p>
                  ) : (
                    <div className={styles.schemaList}>
                      {skill.tools.map((tool) => (
                        <article key={`${skill.id}_${tool.name}`} className={styles.schemaCard}>
                          <header>
                            <strong>{tool.name}</strong>
                            <span>{tool.description || '-'}</span>
                          </header>
                          <pre>{JSON.stringify(tool.parameters ?? {}, null, 2)}</pre>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </AppShell>
  );
}
