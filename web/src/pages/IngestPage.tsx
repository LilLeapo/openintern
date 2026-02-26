import { useCallback, useRef, useState } from 'react';
import { apiClient, type IngestFileProgress } from '../api/client';
import { AppShell } from '../components/Layout/AppShell';
import { useLocaleText } from '../i18n/useLocaleText';
import styles from './IngestPage.module.css';

type JobPhase = 'idle' | 'uploading' | 'processing' | 'done';

const BADGE_CLASS: Record<string, string> = {
  pending: styles.badgePending,
  processing: styles.badgeProcessing,
  completed: styles.badgeCompleted,
  failed: styles.badgeFailed,
};

export function IngestPage() {
  const { t } = useLocaleText();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<JobPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<IngestFileProgress[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Options
  const [enableOcr, setEnableOcr] = useState(false);
  const [enableFormula, setEnableFormula] = useState(false);
  const [enableTable, setEnableTable] = useState(false);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const pdfs = Array.from(incoming).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) return;
    setFiles(prev => [...prev, ...pdfs]);
    setError(null);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleSubmit = useCallback(async () => {
    if (files.length === 0) return;
    setError(null);
    setPhase('uploading');
    setProgress([]);

    try {
      const { job_id } = await apiClient.ingestBatchPdf(files, {
        is_ocr: enableOcr || undefined,
        enable_formula: enableFormula || undefined,
        enable_table: enableTable || undefined,
      });

      setPhase('processing');

      const es = apiClient.createIngestProgressSource(job_id);
      es.onmessage = (evt) => {
        const data = JSON.parse(evt.data) as IngestFileProgress;
        setProgress(prev => {
          const next = [...prev];
          next[data.file_index] = data;
          return next;
        });
      };
      es.addEventListener('done', () => {
        es.close();
        setPhase('done');
      });
      es.onerror = () => {
        es.close();
        setPhase('done');
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
    }
  }, [files, enableOcr, enableFormula, enableTable]);

  const completed = progress.filter(p => p.status === 'completed').length;
  const failed = progress.filter(p => p.status === 'failed').length;
  const totalChunks = progress.reduce((sum, p) => sum + (p.chunk_count ?? 0), 0);
  const isProcessing = phase === 'uploading' || phase === 'processing';

  return (
    <AppShell title={t('ingest.title', 'PDF Batch Import')}>
      <div className={styles.layout}>
        {/* Left: Upload Card */}
        <div className={styles.uploadCard}>
          <h3>{t('ingest.upload', 'Upload PDFs')}</h3>

          <div
            className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {t('ingest.dropHint', 'Drop PDF files here or click to select')}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              multiple
              hidden
              onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>

          {files.length > 0 && (
            <div className={styles.fileList}>
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className={styles.fileItem}>
                  <span>{f.name}</span>
                  {!isProcessing && (
                    <button onClick={() => removeFile(i)}>x</button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className={styles.optionsGrid}>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={enableOcr} onChange={e => setEnableOcr(e.target.checked)} />
              <span>OCR</span>
            </label>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={enableFormula} onChange={e => setEnableFormula(e.target.checked)} />
              <span>{t('ingest.formula', 'Formula')}</span>
            </label>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={enableTable} onChange={e => setEnableTable(e.target.checked)} />
              <span>{t('ingest.table', 'Table')}</span>
            </label>
          </div>

          {error && <p className={styles.errorText}>{error}</p>}

          <button
            className={styles.submitButton}
            disabled={files.length === 0 || isProcessing}
            onClick={handleSubmit}
          >
            {isProcessing
              ? t('ingest.processing', 'Processing...')
              : t('ingest.start', 'Start Import')}
          </button>
        </div>

        {/* Right: Progress Panel */}
        <div className={styles.progressPanel}>
          <h3>{t('ingest.progress', 'Progress')}</h3>

          {progress.length === 0 && (
            <p className={styles.placeholder}>
              {t('ingest.noJob', 'Upload PDFs and click Start to begin')}
            </p>
          )}

          {progress.length > 0 && (
            <div className={styles.progressList}>
              {progress.map(p => (
                <div key={p.file_index} className={styles.progressItem}>
                  <strong>{p.filename}</strong>
                  {p.chunk_count != null && (
                    <span className={styles.chunkCount}>{p.chunk_count} chunks</span>
                  )}
                  <span className={`${styles.badge} ${BADGE_CLASS[p.status] ?? ''}`}>
                    {p.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {phase === 'done' && (
            <div className={styles.summary}>
              <span>{completed} completed</span>
              {failed > 0 && <span>{failed} failed</span>}
              <span>{totalChunks} total chunks</span>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
