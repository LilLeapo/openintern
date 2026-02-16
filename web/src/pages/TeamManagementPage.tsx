/**
 * TeamManagementPage - Modern team management console
 * Master-Detail pattern with roles and groups management
 */

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../components/Layout/AppShell';
import { useLocaleText } from '../i18n/useLocaleText';
import { useTeamManagement } from '../hooks/useTeamManagement';
import type { Role } from '../types';
import styles from './TeamManagementPage.module.css';

export function TeamManagementPage() {
  const { t } = useLocaleText();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    // Data
    filteredRoles,
    filteredGroups,
    selectedRole,
    selectedGroup,
    selectedGroupMembers,
    roleStats,
    groupStats,
    groupRuns,
    loading,
    error,
    // UI state
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    roleFilter,
    setRoleFilter,
    selected,
    setSelected,
    checkedIds,
    toggleChecked,
    clearChecked,
    toast,
    // Operations
    deleteRole,
    deleteGroup,
    batchDelete,
    exportConfig,
    importConfig,
    showToast,
  } = useTeamManagement();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as { roles?: unknown[]; groups?: unknown[] };
      await importConfig(data);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Import failed');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      if (selected.type === 'role') {
        await deleteRole(selected.id);
      } else {
        await deleteGroup(selected.id);
      }
      setShowDeleteConfirm(false);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const currentList = activeTab === 'roles' ? filteredRoles : filteredGroups;
  const hasSelection = selected !== null;
  const hasChecked = checkedIds.size > 0;

  return (
    <AppShell
      title={t('Team Management', '团队管理')}
      subtitle={t('Manage expert profiles and assistant teams', '管理专家画像和助手团队')}
    >
      <>
        {/* Header Toolbar */}
        <div className={styles.toolbar}>
          <button
            className={styles.toolbarBtnPrimary}
            onClick={() => showToast('error', t('Not implemented yet', '尚未实现'))}
          >
            {t('Create Role', '创建角色')}
          </button>
          <button
            className={styles.toolbarBtnPrimary}
            onClick={() => showToast('error', t('Not implemented yet', '尚未实现'))}
          >
            {t('Create Group', '创建团队')}
          </button>
          {hasChecked && (
            <>
              <button className={styles.toolbarBtnDanger} onClick={() => void batchDelete()}>
                {t(`Delete ${checkedIds.size}`, `删除 ${checkedIds.size} 项`)}
              </button>
              <button className={styles.toolbarBtn} onClick={clearChecked}>
                {t('Clear', '清除')}
              </button>
            </>
          )}
          <button className={styles.toolbarBtn} onClick={() => exportConfig('roles')}>
            {t('Export Roles', '导出角色')}
          </button>
          <button className={styles.toolbarBtn} onClick={() => exportConfig('groups')}>
            {t('Export Groups', '导出团队')}
          </button>
          <button className={styles.toolbarBtn} onClick={() => exportConfig('all')}>
            {t('Export All', '导出全部')}
          </button>
          <button className={styles.toolbarBtn} onClick={handleImport}>
            {t('Import', '导入')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        {/* Main Content */}
        <div className={styles.layout}>
          {/* Left Panel - Resource List */}
          <div className={styles.listPanel}>
            {/* Search Bar */}
            <div className={styles.searchRow}>
              <input
                type="text"
                placeholder={t('Search...', '搜索...')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className={styles.searchInput}
              />
            </div>

            {/* Tabs */}
            <div className={styles.tabs}>
              <button
                className={activeTab === 'roles' ? styles.tabActive : styles.tab}
                onClick={() => setActiveTab('roles')}
              >
                {t('Roles', '角色')} ({filteredRoles.length})
              </button>
              <button
                className={activeTab === 'groups' ? styles.tabActive : styles.tab}
                onClick={() => setActiveTab('groups')}
              >
                {t('Groups', '团队')} ({filteredGroups.length})
              </button>
            </div>

            {/* Role Filter */}
            {activeTab === 'roles' && (
              <div className={styles.filterRow}>
                <button
                  className={roleFilter === 'all' ? styles.filterChipActive : styles.filterChip}
                  onClick={() => setRoleFilter('all')}
                >
                  {t('All Roles', '所有角色')}
                </button>
                <button
                  className={roleFilter === 'lead' ? styles.filterChipActive : styles.filterChip}
                  onClick={() => setRoleFilter('lead')}
                >
                  {t('Lead Only', '仅负责人')}
                </button>
                <button
                  className={roleFilter === 'non-lead' ? styles.filterChipActive : styles.filterChip}
                  onClick={() => setRoleFilter('non-lead')}
                >
                  {t('Non-Lead Only', '仅非负责人')}
                </button>
              </div>
            )}

            {/* Resource List */}
            <div className={styles.cardList}>
              {loading && <div className={styles.emptyState}>{t('Loading...', '加载中...')}</div>}
              {error && <div className={styles.emptyState}>{error.message}</div>}
              {!loading && !error && currentList.length === 0 && (
                <div className={styles.emptyState}>
                  {t('No items found', '未找到项目')}
                </div>
              )}
              {!loading && !error && currentList.map(item => {
                const isRole = 'system_prompt' in item;
                const isSelected = selected?.id === item.id;
                const isChecked = checkedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={isSelected ? styles.resourceCardSelected : styles.resourceCard}
                    onClick={() => setSelected({ type: isRole ? 'role' : 'group', id: item.id })}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleChecked(item.id)}
                      onClick={e => e.stopPropagation()}
                      className={styles.cardCheckbox}
                    />
                    <div className={styles.cardBody}>
                      <div className={styles.cardTitle}>
                        {item.name}
                        {isRole && (item as Role).is_lead && (
                          <span className={styles.leadBadge}>{t('Lead', '负责人')}</span>
                        )}
                      </div>
                      {item.description && (
                        <div className={styles.cardMeta}>{item.description}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Panel - Detail View */}
          <div className={styles.detailPanel}>
            {!hasSelection && (
              <div className={styles.detailEmpty}>
                {t('Select an item to view details', '选择一个项目查看详情')}
              </div>
            )}

            {/* Role Detail */}
            {selectedRole && (
              <>
                <div className={styles.detailHeader}>
                  <h2>{selectedRole.name}</h2>
                  <div className={styles.detailActions}>
                    <button
                      className={styles.toolbarBtn}
                      onClick={() => showToast('error', t('Not implemented yet', '尚未实现'))}
                    >
                      {t('Edit', '编辑')}
                    </button>
                    <button
                      className={styles.toolbarBtnDanger}
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      {t('Delete', '删除')}
                    </button>
                  </div>
                </div>

                <div className={styles.detailSection}>
                  <h3>{t('Basic Information', '基本信息')}</h3>
                  <p>{t('Name', '名称')}: {selectedRole.name}</p>
                  <p>{t('Type', '类型')}: {selectedRole.is_lead ? t('Team Lead', '团队负责人') : t('Member', '成员')}</p>
                  {selectedRole.description && (
                    <p>{t('Description', '描述')}: {selectedRole.description}</p>
                  )}
                </div>

                <div className={styles.detailSection}>
                  <h3>{t('System Prompt', '系统提示')}</h3>
                  <pre className={styles.promptBlock}>{selectedRole.system_prompt}</pre>
                </div>

                {(selectedRole.allowed_tools || selectedRole.denied_tools) && (
                  <div className={styles.detailSection}>
                    <h3>{t('Tool Permissions', '工具权限')}</h3>
                    {selectedRole.allowed_tools && selectedRole.allowed_tools.length > 0 && (
                      <div>
                        <span>{t('Allowed:', '允许：')}</span>
                        <div className={styles.tagList}>
                          {selectedRole.allowed_tools.map((tool: string) => (
                            <span key={tool} className={styles.tag}>{tool}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedRole.denied_tools && selectedRole.denied_tools.length > 0 && (
                      <div>
                        <span>{t('Denied:', '禁止：')}</span>
                        <div className={styles.tagList}>
                          {selectedRole.denied_tools.map((tool: string) => (
                            <span key={tool} className={styles.tagDenied}>{tool}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {roleStats && (
                  <div className={styles.detailSection}>
                    <h3>{t('Usage Statistics', '使用统计')}</h3>
                    <div className={styles.statsGrid}>
                      <div className={styles.statCard}>
                        <div className={styles.statValue}>{roleStats.group_count}</div>
                        <div className={styles.statLabel}>{t('Groups Using', '使用的团队')}</div>
                      </div>
                    </div>
                    {roleStats.groups.length > 0 && (
                      <div>
                        {roleStats.groups.map(g => (
                          <button
                            key={g.id}
                            className={styles.toolbarBtn}
                            onClick={() => {
                              setActiveTab('groups');
                              setSelected({ type: 'group', id: g.id });
                            }}
                          >
                            {g.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Group Detail */}
            {selectedGroup && (
              <>
                <div className={styles.detailHeader}>
                  <h2>{selectedGroup.name}</h2>
                  <div className={styles.detailActions}>
                    <button
                      className={styles.toolbarBtn}
                      onClick={() => showToast('error', t('Not implemented yet', '尚未实现'))}
                    >
                      {t('Manage Members', '管理成员')}
                    </button>
                    <button
                      className={styles.toolbarBtn}
                      onClick={() => showToast('error', t('Not implemented yet', '尚未实现'))}
                    >
                      {t('Edit', '编辑')}
                    </button>
                    <button
                      className={styles.toolbarBtnDanger}
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      {t('Delete', '删除')}
                    </button>
                  </div>
                </div>

                <div className={styles.detailSection}>
                  <h3>{t('Basic Information', '基本信息')}</h3>
                  <p>{t('Name', '名称')}: {selectedGroup.name}</p>
                  {selectedGroup.description && (
                    <p>{t('Description', '描述')}: {selectedGroup.description}</p>
                  )}
                  <p>{t('Members', '成员')}: {selectedGroupMembers.length}</p>
                </div>

                {selectedGroupMembers.length > 0 && (
                  <div className={styles.detailSection}>
                    <h3>{t('Team Members', '团队成员')}</h3>
                    <table className={styles.membersTable}>
                      <thead>
                        <tr>
                          <th>{t('Order', '顺序')}</th>
                          <th>{t('Role', '角色')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedGroupMembers.map(member => (
                          <tr key={member.id}>
                            <td>#{member.ordinal}</td>
                            <td>{member.role_id}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {groupStats && (
                  <div className={styles.detailSection}>
                    <h3>{t('Usage Statistics', '使用统计')}</h3>
                    <div className={styles.statsGrid}>
                      <div className={styles.statCard}>
                        <div className={styles.statValue}>{groupStats.run_count}</div>
                        <div className={styles.statLabel}>{t('Total Runs', '总运行次数')}</div>
                      </div>
                      <div className={styles.statCard}>
                        <div className={styles.statValue}>{groupStats.completed_count}</div>
                        <div className={styles.statLabel}>{t('Completed', '已完成')}</div>
                      </div>
                      <div className={styles.statCard}>
                        <div className={styles.statValue}>{groupStats.failed_count}</div>
                        <div className={styles.statLabel}>{t('Failed', '失败')}</div>
                      </div>
                      <div className={styles.statCard}>
                        <div className={styles.statValue}>
                          {(groupStats.success_rate * 100).toFixed(1)}%
                        </div>
                        <div className={styles.statLabel}>{t('Success Rate', '成功率')}</div>
                      </div>
                    </div>
                  </div>
                )}

                {groupRuns.length > 0 && (
                  <div className={styles.detailSection}>
                    <h3>{t('Recent Runs', '最近运行')}</h3>
                    <div>
                      {groupRuns.slice(0, 10).map(run => (
                        <div key={run.run_id} className={styles.runItem}>
                          <span className={styles[`status${run.status}`] || styles.runStatus}>
                            {run.status}
                          </span>
                          <span className={styles.runInput}>{run.input}</span>
                          <span className={styles.runTime}>
                            {new Date(run.created_at).toLocaleString()}
                            {run.duration_ms && ` · ${(run.duration_ms / 1000).toFixed(1)}s`}
                          </span>
                          <button
                            className={styles.toolbarBtn}
                            onClick={() => navigate(`/trace/${run.run_id}`)}
                          >
                            {t('View', '查看')}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Toast Notification */}
        {toast && (
          <div className={toast.type === 'success' ? styles.toastSuccess : styles.toastError}>
            {toast.message}
          </div>
        )}

        {/* Modals - Simplified placeholders for now */}
        {showDeleteConfirm && (
          <div className={styles.modalOverlay} onClick={() => setShowDeleteConfirm(false)}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
              <h3 className={styles.modalTitle}>{t('Confirm Delete', '确认删除')}</h3>
              <p className={styles.confirmText}>{t('Are you sure you want to delete this item?', '确定要删除此项吗？')}</p>
              <div className={styles.modalFooter}>
                <button className={styles.btnCancel} onClick={() => setShowDeleteConfirm(false)}>
                  {t('Cancel', '取消')}
                </button>
                <button className={styles.btnDanger} onClick={() => void handleDelete()}>
                  {t('Delete', '删除')}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    </AppShell>
  );
}
