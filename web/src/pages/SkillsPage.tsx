import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { AppShell } from '../components/Layout/AppShell';
import type { Skill, SkillProvider, SkillRiskLevel } from '../types';
import { useLocaleText } from '../i18n/useLocaleText';
import styles from './SkillsPage.module.css';

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
        parameters: {},
      };
    })
    .filter((tool) => tool.name.length > 0);
}

export function SkillsPage() {
  const { t } = useLocaleText();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

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
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('Failed to load skills', '加载技能失败'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

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

  const totalTools = useMemo(
    () => skills.reduce((count, skill) => count + skill.tools.length, 0),
    [skills]
  );

  return (
    <AppShell
      title={t('Skills Catalog', '技能目录')}
      subtitle={t('Register reusable skill metadata for tool discovery and policy', '注册可复用技能元数据，用于工具发现与策略配置')}
      actions={
        <button className={styles.refreshButton} onClick={() => void loadSkills()}>
          {t('Reload Skills', '重新加载技能')}
        </button>
      }
    >
      <div className={styles.layout}>
        <section className={styles.editorColumn}>
          <article className={styles.card}>
            <h3>{t('Create Skill', '创建技能')}</h3>
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
              <span>{t('Tools (one per line, optional `name|description`)', '工具（每行一个，可选 `name|description`）')}</span>
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
            <h3>{t('Catalog Snapshot', '目录概览')}</h3>
            <p>{t(`Total skills: ${skills.length}`, `技能总数：${skills.length}`)}</p>
            <p>{t(`Total tool refs: ${totalTools}`, `工具引用总数：${totalTools}`)}</p>
            {loading && <p>{t('Loading skills...', '加载技能中...')}</p>}
          </article>
          {skills.map((skill) => (
            <article key={skill.id} className={styles.card}>
              <header className={styles.skillHeader}>
                <div>
                  <h4>{skill.name}</h4>
                  <p className={styles.skillId}>{skill.id}</p>
                </div>
                <button
                  className={styles.deleteButton}
                  onClick={() => void handleDeleteSkill(skill.id)}
                >
                  {t('Delete', '删除')}
                </button>
              </header>
              <p className={styles.metaLine}>
                {t(
                  `provider=${skill.provider} · risk=${skill.risk_level} · health=${skill.health_status}`,
                  `provider=${skill.provider} · 风险=${skill.risk_level} · 健康=${skill.health_status}`,
                )}
              </p>
              {skill.description && <p className={styles.description}>{skill.description}</p>}
              <div>
                <p className={styles.metaLabel}>{t('Tools', '工具')}</p>
                {skill.tools.length === 0 ? (
                  <p className={styles.emptyTools}>{t('No tools bound', '没有绑定工具')}</p>
                ) : (
                  <ul className={styles.toolList}>
                    {skill.tools.map((tool) => (
                      <li key={`${skill.id}-${tool.name}`}>
                        <strong>{tool.name}</strong>
                        {tool.description ? ` - ${tool.description}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
