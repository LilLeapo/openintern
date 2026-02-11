import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { AppShell } from '../components/Layout/AppShell';
import type { Skill, SkillProvider, SkillRiskLevel } from '../types';
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
      setErrorText(error instanceof Error ? error.message : 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const clearMessages = () => {
    setErrorText(null);
    setSuccessText(null);
  };

  const handleCreateSkill = async (): Promise<void> => {
    if (!name.trim()) {
      setErrorText('Skill name is required.');
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
      setSuccessText(`Created skill ${created.id}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to create skill');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSkill = async (skillId: string): Promise<void> => {
    clearMessages();
    try {
      await apiClient.deleteSkill(skillId);
      setSkills((prev) => prev.filter((skill) => skill.id !== skillId));
      setSuccessText(`Deleted skill ${skillId}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to delete skill');
    }
  };

  const totalTools = useMemo(
    () => skills.reduce((count, skill) => count + skill.tools.length, 0),
    [skills]
  );

  return (
    <AppShell
      title="Skills Catalog"
      subtitle="Register reusable skill metadata for tool discovery and policy"
      actions={
        <button className={styles.refreshButton} onClick={() => void loadSkills()}>
          Reload Skills
        </button>
      }
    >
      <div className={styles.layout}>
        <section className={styles.editorColumn}>
          <article className={styles.card}>
            <h3>Create Skill</h3>
            <label className={styles.field}>
              <span>Name</span>
              <input
                aria-label="Skill Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Knowledge Retrieval"
              />
            </label>
            <label className={styles.field}>
              <span>Description</span>
              <input
                aria-label="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="When to use and constraints"
              />
            </label>
            <div className={styles.inlineFields}>
              <label className={styles.field}>
                <span>Provider</span>
                <select
                  aria-label="Provider"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as SkillProvider)}
                >
                  <option value="builtin">builtin</option>
                  <option value="mcp">mcp</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Risk Level</span>
                <select
                  aria-label="Risk Level"
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
              <span>Tools (one per line, optional `name|description`)</span>
              <textarea
                aria-label="Tools"
                className={styles.textarea}
                value={toolsDraft}
                onChange={(event) => setToolsDraft(event.target.value)}
                placeholder={`memory_search|semantic memory lookup\nread_file|read UTF-8 file`}
              />
            </label>
            <button
              className={styles.primaryButton}
              onClick={() => void handleCreateSkill()}
              disabled={saving}
            >
              {saving ? 'Creating...' : 'Create Skill'}
            </button>
          </article>
          {errorText && <p className={styles.errorText}>{errorText}</p>}
          {successText && <p className={styles.successText}>{successText}</p>}
        </section>

        <section className={styles.listColumn}>
          <article className={styles.card}>
            <h3>Catalog Snapshot</h3>
            <p>Total skills: {skills.length}</p>
            <p>Total tool refs: {totalTools}</p>
            {loading && <p>Loading skills...</p>}
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
                  Delete
                </button>
              </header>
              <p className={styles.metaLine}>
                provider={skill.provider} · risk={skill.risk_level} · health={skill.health_status}
              </p>
              {skill.description && <p className={styles.description}>{skill.description}</p>}
              <div>
                <p className={styles.metaLabel}>Tools</p>
                {skill.tools.length === 0 ? (
                  <p className={styles.emptyTools}>No tools bound</p>
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
