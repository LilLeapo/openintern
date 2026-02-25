/**
 * ApprovalCard - displays tool approval request with approve/reject actions
 */

import { useState } from 'react';
import type { PendingApproval } from '../../hooks/useChat';
import styles from './ApprovalCard.module.css';

interface ApprovalCardProps {
  approval: PendingApproval;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}

export function ApprovalCard({ approval, onApprove, onReject }: ApprovalCardProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const handleApprove = async () => {
    setIsProcessing(true);
    try {
      await onApprove();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    setIsProcessing(true);
    try {
      await onReject(rejectReason || undefined);
      setShowRejectReason(false);
      setRejectReason('');
    } finally {
      setIsProcessing(false);
    }
  };

  const formatArgs = (args: Record<string, unknown>): string => {
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  };

const getRiskLevelClass = (level: string): string => {
    switch (level.toLowerCase()) {
      case 'high':
        return styles.riskHigh ?? '';
      case 'medium':
        return styles.riskMedium ?? '';
      case 'low':
        return styles.riskLow ?? '';
      default:
        return '';
    }
  };

  return (
    <div className={styles.approvalCard}>
      <div className={styles.header}>
        <div className={styles.title}>
          <span className={styles.icon}>⚠️</span>
          <span>Tool Approval Required</span>
        </div>
        <div className={`${styles.riskBadge} ${getRiskLevelClass(approval.riskLevel)}`}>
          {approval.riskLevel.toUpperCase()} RISK
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.section}>
          <div className={styles.label}>Tool:</div>
          <div className={styles.value}>
            <code>{approval.toolName}</code>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.label}>Reason:</div>
          <div className={styles.value}>{approval.reason}</div>
        </div>

        <div className={styles.section}>
          <div className={styles.label}>Arguments:</div>
          <pre className={styles.args}>{formatArgs(approval.args)}</pre>
        </div>
      </div>

      {!showRejectReason ? (
        <div className={styles.actions}>
          <button
            className={`${styles.button} ${styles.rejectButton}`}
            onClick={() => setShowRejectReason(true)}
            disabled={isProcessing}
          >
            Reject
          </button>
          <button
            className={`${styles.button} ${styles.approveButton}`}
            onClick={handleApprove}
            disabled={isProcessing}
          >
            {isProcessing ? 'Approving...' : 'Approve'}
          </button>
        </div>
      ) : (
        <div className={styles.rejectForm}>
          <textarea
            className={styles.rejectInput}
            placeholder="Reason for rejection (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <div className={styles.actions}>
            <button
              className={`${styles.button} ${styles.cancelButton}`}
              onClick={() => {
                setShowRejectReason(false);
                setRejectReason('');
              }}
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button
              className={`${styles.button} ${styles.rejectButton}`}
              onClick={handleReject}
              disabled={isProcessing}
            >
              {isProcessing ? 'Rejecting...' : 'Confirm Reject'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
