import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { BlackboardPanel } from '../components/Blackboard';
import { AppShell } from '../components/Layout/AppShell';
import { useAppPreferences } from '../context/AppPreferencesContext';
import type { Group, Role, EpisodicType } from '../types';
import styles from './BlackboardPage.module.css';

export function BlackboardPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { selectedGroupId, setSelectedGroupId, sessionKey } = useAppPreferences();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [memoryType, setMemoryType] = useState<EpisodicType>('DECISION');
  const [text, setText] = useState('');
  const [rationale, setRationale] = useState('');
  const [importance, setImportance] = useState(0.75);
  const [roleId, setRoleId] = useState('');

  useEffect(() => {
    const loadCatalog = async () => {
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const [groupData, roleData] = await Promise.all([
          apiClient.listGroups(),
          apiClient.listRoles(),
        ]);
        setGroups(groupData);
        setRoles(roleData);
        setRoleId(prev => prev || roleData[0]?.id || '');
      } catch (err) {
        setCatalogError(err instanceof Error ? err.message : 'Failed to load groups and roles');
      } finally {
        setCatalogLoading(false);
      }
    };

    void loadCatalog();
  }, []);

  useEffect(() => {
    if (!groupId) return;
    setSelectedGroupId(groupId);
  }, [groupId, setSelectedGroupId]);

  const activeGroupId = useMemo(() => {
    if (groupId) return groupId;
    if (selectedGroupId) return selectedGroupId;
    return groups[0]?.id ?? null;
  }, [groupId, selectedGroupId, groups]);

  useEffect(() => {
    if (!activeGroupId) return;
    if (groupId === activeGroupId) return;
    navigate(`/blackboard/${activeGroupId}`, { replace: true });
  }, [activeGroupId, groupId, navigate]);

  const handleWrite = async (): Promise<void> => {
    if (!activeGroupId || !roleId || !text.trim()) {
      setSubmitError('Group, role and content are required.');
      return;
    }

    const trimmedText = text.trim();
    const payloadText = (() => {
      if (memoryType === 'DECISION') {
        const rationaleLine = rationale.trim() ? `\nRationale: ${rationale.trim()}` : '';
        return `DECISION: ${trimmedText}${rationaleLine}`;
      }
      if (memoryType === 'EVIDENCE') {
        return `EVIDENCE: ${trimmedText}`;
      }
      return `TODO: ${trimmedText}`;
    })();

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await apiClient.writeBlackboard(activeGroupId, {
        type: 'episodic',
        text: payloadText,
        role_id: roleId,
        importance,
        metadata: {
          episodic_type: memoryType,
          session_key: sessionKey,
        },
      });
      setText('');
      setRationale('');
      setRefreshNonce(value => value + 1);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to write to blackboard');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell
      title="Group Blackboard"
      subtitle="Consensus, evidence, and actionable TODO memory"
      actions={
        <button
          className={styles.pageAction}
          onClick={() => navigate('/')}
        >
          Back to Chat
        </button>
      }
    >
      <div className={styles.layout}>
        <section className={styles.formCard}>
          <h3>Write Memory</h3>
          {catalogError && <p className={styles.errorText}>{catalogError}</p>}
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Group</span>
              <select
                value={activeGroupId ?? ''}
                onChange={e => {
                  const nextId = e.target.value;
                  setSelectedGroupId(nextId || null);
                  if (nextId) {
                    navigate(`/blackboard/${nextId}`);
                  }
                }}
                disabled={catalogLoading}
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
                value={roleId}
                onChange={e => setRoleId(e.target.value)}
                disabled={catalogLoading}
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
              <span>Type</span>
              <select
                value={memoryType}
                onChange={e => setMemoryType(e.target.value as EpisodicType)}
              >
                <option value="DECISION">DECISION</option>
                <option value="EVIDENCE">EVIDENCE</option>
                <option value="TODO">TODO</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>Importance ({importance.toFixed(2)})</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={importance}
                onChange={e => setImportance(Number.parseFloat(e.target.value))}
              />
            </label>
          </div>
          <label className={styles.field}>
            <span>Content</span>
            <textarea
              className={styles.textarea}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={
                memoryType === 'TODO'
                  ? 'Describe the action item'
                  : 'Describe this memory clearly'
              }
            />
          </label>
          {memoryType === 'DECISION' && (
            <label className={styles.field}>
              <span>Rationale (optional)</span>
              <input
                value={rationale}
                onChange={e => setRationale(e.target.value)}
                placeholder="Why this decision was made"
              />
            </label>
          )}
          {submitError && <p className={styles.errorText}>{submitError}</p>}
          <button
            className={styles.submitButton}
            onClick={() => void handleWrite()}
            disabled={isSubmitting || !activeGroupId || !roleId || !text.trim()}
          >
            {isSubmitting ? 'Writing...' : 'Write to Blackboard'}
          </button>
        </section>
        <section className={styles.panelSection}>
          <BlackboardPanel groupId={activeGroupId} refreshNonce={refreshNonce} />
        </section>
      </div>
    </AppShell>
  );
}
