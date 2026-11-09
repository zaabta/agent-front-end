import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileClock, LoaderCircle, RotateCcw, Upload, X } from 'lucide-react'
import { api, ApiError, type DocumentVersion, type SitePilotDocument } from '../../lib/api/client'

const fileAccept = '.md,.txt,.docx,.pdf,.xlsx,.xls,.csv'
const activeJobs = ['queued', 'processing', 'reindexing']
const readyVersions = ['ready', 'failed', 'cancelled']

function errorText(error: unknown) {
  return error instanceof ApiError ? `${error.message}${error.status ? ` (HTTP ${error.status})` : ''}` : error instanceof Error ? error.message : 'The request failed.'
}

export function DocumentVersionPanel({ document, onClose }: { document: SitePilotDocument; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [trackedJobId, setTrackedJobId] = useState('')
  const [transfer, setTransfer] = useState<number | null>(null)
  const documentQuery = useQuery({ queryKey: ['document', document.id], queryFn: ({ signal }) => api.document(document.id, signal) })
  const versionsQuery = useQuery({ queryKey: ['document-versions', document.id], queryFn: () => api.documentVersions(document.id), retry: 1 })
  const versionQuery = useQuery({ queryKey: ['document-version', document.id, selectedVersionId], queryFn: () => api.documentVersion(document.id, selectedVersionId), enabled: !!selectedVersionId })
  const trackedJob = useQuery({ queryKey: ['jobs', trackedJobId], queryFn: ({ signal }) => api.job(trackedJobId, signal), enabled: !!trackedJobId, refetchInterval: query => ['ready','completed','failed','cancelled'].includes(query.state.data?.status ?? '') ? false : 1500 })
  useEffect(() => { if (trackedJob.data && ['ready','completed','failed','cancelled'].includes(trackedJob.data.status)) void Promise.all([queryClient.invalidateQueries({ queryKey: ['document-versions', document.id] }), queryClient.invalidateQueries({ queryKey: ['documents'] })]) }, [trackedJob.data?.status, document.id, queryClient])

  async function finishMutation(message: string) {
    setError(''); setNotice(message)
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['document-versions', document.id] }), queryClient.invalidateQueries({ queryKey: ['documents'] }), queryClient.invalidateQueries({ queryKey: ['document', document.id] })])
  }

  async function uploadVersion() {
    if (!file || busy) return
    setBusy(true); setError(''); setNotice(''); setTransfer(0)
    try {
      const accepted = await api.uploadDocumentVersion(document.id, file, reason, percent => setTransfer(percent))
      setNotice(`Version ${accepted.status}`); setTrackedJobId(accepted.jobId); setFile(null); setReason('')
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['jobs', accepted.jobId] }), queryClient.invalidateQueries({ queryKey: ['document-versions', document.id] }), queryClient.invalidateQueries({ queryKey: ['documents'] })])
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false); setTransfer(null) }
  }

  async function runAction(action: 'restore' | 'reindex' | 'cancel', version: DocumentVersion) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = action === 'restore' ? await api.restoreDocumentVersion(document.id, version.id)
        : action === 'reindex' ? await api.reindexDocumentVersion(document.id, version.id)
          : await api.cancelDocumentVersionJob(document.id, version.id)
      if (result.jobId || version.jobId) setTrackedJobId(result.jobId ?? version.jobId ?? '')
      await finishMutation(`${action === 'restore' ? 'Restore' : action === 'reindex' ? 'Reindex' : 'Cancellation'} · ${result.status}`)
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }

  const versions = versionsQuery.data?.versions ?? []
  return <section className="document-version-panel" aria-label={`Versions for ${document.fileName}`}>
    <div className="document-version-heading"><div><b>Document versions</b><small>{documentQuery.data ? `Current document status · ${documentQuery.data.status}` : versionsQuery.data ? `${versionsQuery.data.total} version${versionsQuery.data.total === 1 ? '' : 's'} · active version is marked` : 'Version history for this document'}</small></div><button type="button" className="icon-button" aria-label="Close version history" onClick={onClose}><X size={15}/></button></div>
    {versionsQuery.isPending ? <div className="version-state"><LoaderCircle className="spin" size={15}/> Loading versions…</div> : versionsQuery.isError ? <div className="version-error" role="alert"><span>{errorText(versionsQuery.error)}</span><button type="button" onClick={() => void versionsQuery.refetch()}>Retry</button></div> : versions.length ? <div className="document-version-list">{versions.map(version => <article className="document-version-row" key={version.id}>
      <span className="version-number">v{version.versionNumber}</span><span className="version-meta"><b>{version.filename}</b><small>{version.status} · {version.indexedChunkCount} chunks · {new Date(version.uploadedAt).toLocaleString()}{versionsQuery.data?.activeVersionId === version.id ? ' · Active' : ''}</small></span>
      <button type="button" className="version-action" onClick={() => setSelectedVersionId(current => current === version.id ? '' : version.id)}>{selectedVersionId === version.id ? 'Hide details' : 'Details'}</button>
      {versionsQuery.data?.activeVersionId === version.id ? <span className="version-active"><Check size={13}/> Active</span> : <div className="version-actions">{readyVersions.includes(version.status) && <button type="button" className="version-action" disabled={busy} onClick={() => void runAction('restore', version)}><RotateCcw size={12}/> Restore</button>}{readyVersions.includes(version.status) && <button type="button" className="version-action" disabled={busy} onClick={() => void runAction('reindex', version)}><FileClock size={12}/> Reindex</button>}{activeJobs.includes(version.status) && <button type="button" className="version-action danger" disabled={busy} onClick={() => void runAction('cancel', version)}><X size={12}/> Cancel</button>}</div>}
      {selectedVersionId === version.id && <VersionDetails version={versionQuery.data} loading={versionQuery.isPending} error={versionQuery.error} />}
    </article>)}</div> : <p className="version-state">No version history was returned for this document.</p>}
    {error && <p className="version-error" role="alert">{error}</p>}{notice && <p className="version-notice" role="status">{notice}</p>}{trackedJob.isError&&<p className="version-error" role="alert">Could not refresh version job status. {errorText(trackedJob.error)} <button type="button" onClick={()=>void trackedJob.refetch()}>Retry</button></p>}{trackedJob.data&&<div className={`version-job-progress ${['failed','cancelled'].includes(trackedJob.data.status)?'version-error':''}`} role="status"><span>{trackedJob.data.status==='ready'||trackedJob.data.status==='completed'?'Version indexed':`${trackedJob.data.status} · ${trackedJob.data.progressDetails?.stage??trackedJob.data.stage??'queued'}`}</span>{trackedJob.data.progressDetails?.stagePercent!=null&&<span>{trackedJob.data.progressDetails.stagePercent}%</span>}{trackedJob.data.errorCode&&<b>{trackedJob.data.errorCode}</b>}</div>}
    <div className="version-upload"><div><b>Upload a replacement version</b><small>The current active version stays available until the new version finishes indexing.</small></div><label className="version-file-select"><Upload size={14}/>{file ? file.name : 'Choose file'}<input type="file" accept={fileAccept} onChange={event => setFile(event.currentTarget.files?.[0] ?? null)}/></label><input className="version-reason" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Replacement reason (optional)"/><button type="button" className="button primary" disabled={!file || busy} onClick={() => void uploadVersion()}>{busy ? <><LoaderCircle className="spin" size={14}/> Working…</> : 'Upload version'}</button>{transfer !== null && <small className="version-transfer">Upload transfer · {transfer === 0 ? 'Starting…' : `${transfer}%`}</small>}</div>
  </section>
}

function VersionDetails({ version, loading, error }: { version?: DocumentVersion; loading: boolean; error: unknown }) {
  if (loading) return <p className="version-detail">Loading version metadata…</p>
  if (error) return <p className="version-detail version-error">{errorText(error)}</p>
  if (!version) return null
  return <dl className="version-detail"><div><dt>MIME type</dt><dd>{version.mimeType}</dd></div><div><dt>Checksum</dt><dd>{version.checksum ?? 'Unavailable'}</dd></div><div><dt>Chunking</dt><dd>{version.chunkingStrategy ?? 'Unavailable'} · {version.chunkerVersion ?? 'version unavailable'}</dd></div><div><dt>Embedding</dt><dd>{version.embeddingModel ?? 'Unavailable'}{version.embeddingDimensions ? ` · ${version.embeddingDimensions} dimensions` : ''}</dd></div><div><dt>Index</dt><dd>Generation {version.indexGeneration}{version.activeIndexGeneration ? ` · active generation ${version.activeIndexGeneration}` : ''}</dd></div><div><dt>Replacement reason</dt><dd>{version.replacementReason ?? 'None supplied'}</dd></div></dl>
}
