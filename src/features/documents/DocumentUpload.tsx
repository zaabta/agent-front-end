import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Check, CheckCircle2, FileSpreadsheet, FileText, LoaderCircle, RotateCcw, Upload, X } from 'lucide-react'
import { api, ApiError, type JobStatus, type SitePilotDocument } from '../../lib/api/client'
import { subscribeJobEvents } from '../../lib/sse/job-events'
import { useAuth } from '../../lib/auth/AuthProvider'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_FILE_BYTES = 10 * 1024 * 1024
const jobsStorageKey = (tenantId:string,userId:string) => `sitepilot:lastUploadJobs:${tenantId}:${userId}`
const SUPPORTED_FORMATS = ['.md', '.txt', '.docx', '.pdf', '.xlsx', '.xls', '.csv'] as const
const SUPPORTED_ACCEPT = {
  [XLSX_MIME]: ['.xlsx'],
  [DOCX_MIME]: ['.docx'],
  'text/plain': ['.txt', '.md'],
  'text/markdown': ['.md'],
  'text/x-markdown': ['.md'],
  'application/pdf': ['.pdf'],
  'application/vnd.ms-excel': ['.xls', '.csv'],
  'text/csv': ['.csv'],
}

type UploadRow = {
  id: string
  fileName: string
  size: number
  file?: File
  jobId?: string
  documentId?: string
  backendStatus?: string
  failureCode?: string
  transferPercent?: number | null
  stage: 'ready' | 'uploading' | 'processing' | 'indexed' | 'failed' | 'cancelled'
  error?: string
}

function restoreJobs(tenantId:string,userId:string): UploadRow[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(jobsStorageKey(tenantId,userId)) ?? '[]')
    const restored = Array.isArray(saved) ? saved.filter((row): row is UploadRow =>
      !!row && typeof row === 'object' && typeof row.id === 'string' &&
      typeof row.jobId === 'string' && typeof row.fileName === 'string' &&
      typeof row.size === 'number',
    ).map(row => ({ ...row, stage: 'processing' as const })) : []
    return restored
  } catch { return [] }
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ''}`
}

function displayError(error: unknown) {
  if (error instanceof ApiError) return `${error.message}${error.code ? ` · ${error.code}` : ''}${error.status ? ` (HTTP ${error.status})` : ''}`
  return error instanceof Error ? error.message : 'The upload failed. Check your connection and try again.'
}

function jobIngestionComplete(job: JobStatus | undefined) {
  // The backend emits `completed` as the terminal ingestion stage, but may
  // leave its aggregate percentage/counters null. The terminal stage itself
  // is authoritative; waiting for optional counters leaves a finished job
  // spinning forever.
  return !!job && (['ready', 'completed'].includes(job.status) || job.stage === 'completed' || job.progressDetails?.stage === 'completed')
}

function fileIcon(name: string) {
  return name.toLowerCase().endsWith('.xlsx') ? FileSpreadsheet : FileText
}

function fileType(name: string) {
  const extension = name.toLowerCase().split('.').pop()
  return extension ? `.${extension}` : 'Unknown type'
}

export function DocumentUpload() {
  const auth = useAuth()
  const canWriteDocuments = ['SUPER_ADMIN','TENANT_ADMIN','MEMBER'].includes(auth.session?.identity.role ?? '')
  const [rows, setRows] = useState<UploadRow[]>(() => auth.session ? restoreJobs(auth.session.identity.tenantId,auth.session.identity.userId) : [])
  const [uploading, setUploading] = useState(false)
  const queryClient = useQueryClient()
  const previousToken = useRef(auth.session?.accessToken ?? null)
  const trackedRows = useMemo(() => rows.filter(row => row.jobId), [rows])
  const jobs = useQueries({ queries: trackedRows.map(row => ({
    queryKey: ['jobs', row.jobId],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.job(row.jobId!, signal),
    enabled: !!auth.session,
    refetchInterval: (query: { state: { data?: JobStatus } }) => query.state.data && (jobIngestionComplete(query.state.data) || ['failed', 'cancelled'].includes(query.state.data.status)) ? false : 1500,
  })) })
  const jobRows = useMemo(() => trackedRows.filter((row,index) => {
    const status = jobs[index]?.data?.status
    return row.stage === 'processing' && !jobIngestionComplete(jobs[index]?.data) && !['failed','cancelled'].includes(status ?? '')
  }), [trackedRows, jobs])

  useEffect(() => {
    const jobIds = [...new Set(jobRows.map(row => row.jobId!).filter(Boolean))]
    if (!jobIds.length || !auth.session) return
    const abort = new AbortController()
    const close = jobIds.map(jobId => subscribeJobEvents(jobId, () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs', jobId] })
    }, () => { /* Status polling continues if SSE cannot connect. */ }, abort.signal))
    return () => { abort.abort(); close.forEach(stop => stop()) }
  }, [jobRows, queryClient, auth.session?.accessToken])

  useEffect(() => {
    const token = auth.session?.accessToken ?? null
    if (!token) {
      setRows([])
      previousToken.current = null
      return
    }
    if (!previousToken.current && auth.session) setRows(restoreJobs(auth.session.identity.tenantId,auth.session.identity.userId))
    previousToken.current = token
  }, [auth.session?.accessToken])

  useEffect(() => {
    if (!auth.session) return
    const resumable = rows.filter(row => row.jobId).map(({ id, fileName, size, jobId, documentId, backendStatus }) => ({ id, fileName, size, jobId, documentId, backendStatus }))
    sessionStorage.setItem(jobsStorageKey(auth.session.identity.tenantId,auth.session.identity.userId), JSON.stringify(resumable))
  }, [rows, auth.session?.accessToken,auth.session?.identity.tenantId,auth.session?.identity.userId])

  const update = useCallback((id: string, patch: Partial<UploadRow>) => {
    setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row))
  }, [])
  const updateAcceptedDocument=useCallback((document:SitePilotDocument)=>{queryClient.setQueryData<SitePilotDocument[]>(['document-upload-overlays'],current=>[document,...(current??[]).filter(item=>item.id!==document.id)])},[queryClient])
  const jobsStateKey=jobs.map((result,index)=>{const job=result.data;return `${trackedRows[index]?.jobId??''}:${job?.status??''}:${job?.stage??''}:${job?.progressDetails?.stagePercent??''}:${job?.progressDetails?.overallPercent??''}:${job?.progressDetails?.completedUnits??''}:${job?.progressDetails?.totalUnits??''}:${job?.errorCode??''}`}).join('|')
  useEffect(()=>{for(const [index,result] of jobs.entries()){const job=result.data;const row=trackedRows[index];if(!job||!row?.documentId)continue;const complete=jobIngestionComplete(job);const document=queryClient.getQueryData<SitePilotDocument[]>(['document-upload-overlays'])?.find(item=>item.id===row.documentId);if(document)updateAcceptedDocument({...document,status:complete?'ready':job.status,active:complete})}if(jobs.some(result=>jobIngestionComplete(result.data)))void queryClient.invalidateQueries({queryKey:['documents']})},[jobsStateKey,queryClient,trackedRows,updateAcceptedDocument])

  const onDrop = useCallback((files: File[]) => {
    if (!files.length) return
    const accepted = files.map(file => ({
      id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      fileName: file.name,
      size: file.size,
      file,
      stage: 'ready' as const,
    }))
    setRows(current => [...current, ...accepted])
  }, [])

  const drop = useDropzone({ onDrop, accept: SUPPORTED_ACCEPT, maxSize: MAX_FILE_BYTES, multiple: true, disabled: !canWriteDocuments })
  const rejectionRows = drop.fileRejections.map(({ file, errors }) => ({
    fileName: file.name,
    message: file.name.toLowerCase().endsWith('.doc')
      ? 'Legacy .doc files are not supported. Save this document as .docx and try again.'
      : errors.some(error => error.code === 'file-too-large')
        ? 'File exceeds the backend 10 MiB default per-file limit.'
        : `Unsupported file. Choose ${SUPPORTED_FORMATS.join(', ')}.`,
  }))

  function acceptUpload(rowId:string,created:Awaited<ReturnType<typeof api.upload>>){
    updateAcceptedDocument(created.document)
    update(rowId,{stage:'processing',jobId:created.jobId,documentId:created.documentId,backendStatus:created.status,transferPercent:created.progress.percent??99,error:undefined,failureCode:undefined})
  }

  async function startUploads() {
    if (uploading || !auth.session) return
    const pending = rows.filter(row => row.stage === 'ready' && row.file)
    if (!pending.length) return
    setUploading(true)
    try {
      // The backend requires exactly one multipart `file` field per request.
      // Run each file independently so one rejection does not stop the rest.
      for (const row of pending) {
        update(row.id, { stage: 'uploading', transferPercent: 0, error: undefined })
        try {
          const created = await api.upload(row.file!, percent => update(row.id, { transferPercent: percent }))
          acceptUpload(row.id,created)
          await queryClient.invalidateQueries({ queryKey: ['jobs', created.jobId] })
        } catch (error) {
          update(row.id, { stage: 'failed', transferPercent: undefined, error: displayError(error) })
        }
      }
    } finally { setUploading(false) }
  }

  async function retry(row: UploadRow) {
    if (!row.file || uploading || !auth.session) return
    update(row.id, { jobId: undefined, stage: 'ready', error: undefined, transferPercent: undefined })
    setUploading(true)
    update(row.id, { stage: 'uploading', transferPercent: 0 })
    try {
      const created = await api.upload(row.file, percent => update(row.id, { transferPercent: percent }))
      acceptUpload(row.id,created)
      await queryClient.invalidateQueries({queryKey:['jobs',created.jobId]})
    } catch (error) { update(row.id, { stage: 'failed', error: displayError(error), transferPercent: undefined }) }
    finally { setUploading(false) }
  }

  const uploadable = canWriteDocuments && rows.some(row => row.stage === 'ready' && row.file)
  const derivedRows = rows.map(row => {
    if (!row.jobId) return row
    const jobIndex = trackedRows.findIndex(item => item.jobId === row.jobId)
    const job = jobIndex >= 0 ? jobs[jobIndex]?.data : undefined
    if (!job) return row
    if (jobIngestionComplete(job)) return { ...row, stage: 'indexed' as const, backendStatus:'ready', failureCode:undefined, error: undefined }
    if (job.status === 'cancelled') return { ...row, stage: 'cancelled' as const, backendStatus:job.status, failureCode:job.errorCode, error: undefined }
    if (job.status === 'failed') return { ...row, stage: 'failed' as const, backendStatus:job.status, failureCode:job.errorCode, error: job.errorCode ?? 'Processing failed.' }
    return { ...row, stage: 'processing' as const, backendStatus:job.status, failureCode:job.errorCode }
  })
  const visibleUploadRows = derivedRows.filter(row => row.stage !== 'indexed')

  return <>
    <div className="document-layout">
      <section className="panel upload-panel">
        <div className="panel-heading"><div><h3>Upload documents</h3><p>Select or drop several supported files. Each file is processed independently.</p></div><span className="supported-badge"><Check size={13}/> 7 formats supported</span></div>
        <div {...drop.getRootProps()} className={`dropzone ${drop.isDragActive ? 'dragging' : ''}`}>
          <input {...drop.getInputProps()} />
          <div className="upload-icon"><Upload size={19}/></div>
          <b>{drop.isDragActive ? 'Drop your files here' : 'Drag and drop files here'}</b>
          <p>or <button type="button" onClick={event => { event.stopPropagation(); drop.open() }}>browse files</button> from your computer</p>
          <small>.md · .txt · .docx · .pdf · .xlsx · .xls · .csv · Max 10 MiB per file</small>
        </div>
        {rejectionRows.map((item, index) => <div className="form-error" key={`${item.fileName}-${index}`}><AlertCircle size={14}/><span><b>{item.fileName}</b>: {item.message}</span></div>)}
        {!auth.session && <div className="form-error"><AlertCircle size={14}/><span>Sign in with an authorized workspace identity before uploading files or checking processing status.</span></div>}
        {auth.session&&!canWriteDocuments&&<div className="form-error"><AlertCircle size={14}/><span>Your workspace role is read-only. Ask a workspace administrator for document upload access.</span></div>}
        {visibleUploadRows.length > 0 && <div className="batch-upload-list" aria-live="polite">{visibleUploadRows.map(row => {
          const Icon = fileIcon(row.fileName)
          const jobIndex = row.jobId ? trackedRows.findIndex(item => item.jobId === row.jobId) : -1
          const jobQuery = jobIndex >= 0 ? jobs[jobIndex] : undefined
          const job = jobQuery?.data
          const details=job?.progressDetails
          const stage=details?.stage||job?.stage||row.backendStatus||'queued'
          const overallPercent=details?.overallPercent??job?.progress.percent??null
          const stagePercent=details?.stagePercent??null
          const overallDeterminate=overallPercent!=null
          const stageDeterminate=stagePercent!=null
          const overallProgress=overallDeterminate?Math.max(0,Math.min(99,overallPercent)):null
          const currentStageProgress=stageDeterminate?Math.max(0,Math.min(99,stagePercent)):null
          const unit=details?.unit?` ${details.unit}`:''
          const unitProgress=details?.completedUnits!=null?`${details.completedUnits}${details.totalUnits!=null?` / ${details.totalUnits}`:''}${unit} completed`:''
          const remainingProgress=details?.remainingUnits!=null?`${details.remainingUnits}${unit} remaining`:''
          const rate=details?.unitsPerSecond!=null?`${details.unitsPerSecond.toFixed(1)}${unit}/s`:''
          const eta=details?.etaMs!=null?`~${formatDuration(details.etaMs)} left`:''
          const status = row.stage === 'indexed' ? 'Ready' : row.stage === 'failed' ? `Failed${row.backendStatus?` · ${row.backendStatus}`:''}` : row.stage === 'cancelled' ? `Cancelled${row.backendStatus?` · ${row.backendStatus}`:''}` : row.stage === 'uploading' ? 'Uploading' : row.stage === 'processing' ? `Processing · ${stage}` : 'Ready to upload'
          return <article className={`batch-upload-item ${row.stage === 'failed' ? 'failed' : ''}`} key={row.id}>
            <Icon size={18}/><div className="batch-upload-info"><b title={row.fileName}>{row.fileName}</b><small>{formatBytes(row.size)} · {fileType(row.fileName)} · {status}</small>
              {row.stage === 'uploading' && <><div className="progress-track"><span style={{ width: `${row.transferPercent ?? 0}%` }}/></div><small>Upload transfer · {row.transferPercent == null ? 'measuring…' : `${row.transferPercent}%`}</small></>}
              {row.stage === 'processing' && <><div className={`progress-track ${overallDeterminate?'':'indeterminate'}`} role="progressbar" aria-label={`Overall ingestion progress for ${row.fileName}`} aria-valuemin={0} aria-valuemax={100} {...(overallDeterminate?{'aria-valuenow':overallProgress!}:{})}><span style={overallDeterminate?{width:`${overallProgress}%`}:undefined}/></div><small>Estimated overall progress{overallDeterminate?` · ${overallProgress}%`:''}</small><div className={`progress-track stage-progress-track ${stageDeterminate?'':'indeterminate'}`} role="progressbar" aria-label={`Ingestion progress for ${row.fileName}`} aria-valuemin={0} aria-valuemax={100} {...(stageDeterminate?{'aria-valuenow':currentStageProgress!}:{})}><span style={stageDeterminate?{width:`${currentStageProgress}%`}:undefined}/></div><small>Current stage · {stage}{stageDeterminate?` · ${currentStageProgress}%`:''}{unitProgress?` · ${unitProgress}`:''}{remainingProgress?` · ${remainingProgress}`:''}{rate?` · ${rate}`:''}{eta?` · ${eta}`:''}</small></>}
              {row.stage === 'indexed' && <><div className="progress-track" role="progressbar" aria-label={`Ingestion progress for ${row.fileName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={100}><span style={{width:'100%'}}/></div><small>Ingestion · Ready · 100%</small></>}
              {row.stage === 'processing' && jobQuery?.isError && <small className="job-error">Could not refresh job status. {displayError(jobQuery.error)} <button type="button" className="text-link" onClick={() => void jobQuery.refetch()}>Retry status check</button></small>}
              {row.error && <small className="job-error">{row.error}</small>}
              {(row.stage==='failed'||row.stage==='cancelled')&&<small className="job-error">{row.failureCode?`Failure code · ${row.failureCode}`:`Backend status · ${row.backendStatus??row.stage}`}</small>}
            </div>
            {row.stage === 'indexed' ? <CheckCircle2 size={17} className="upload-complete-icon"/> : row.stage === 'failed'||row.stage==='cancelled' ? <div className="upload-row-actions">{row.file&&canWriteDocuments&&<button type="button" className="icon-button" aria-label={`Retry ${row.fileName}`} disabled={uploading || !auth.session} onClick={() => void retry(row)}><RotateCcw size={15}/></button>}<button type="button" className="upload-dismiss-button" onClick={()=>setRows(current=>current.filter(item=>item.id!==row.id))}>Dismiss</button></div> : row.stage === 'processing' && row.jobId ? canWriteDocuments?<button type="button" className="document-cancel-button" onClick={()=>void api.cancelJob(row.jobId!).then(()=>queryClient.invalidateQueries({queryKey:['jobs',row.jobId]}))}><X size={13}/> Cancel</button>:null : row.stage === 'uploading' ? <LoaderCircle size={16} className="spin"/> : <button type="button" className="icon-button" aria-label={`Remove ${row.fileName}`} disabled={uploading} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}><X size={15}/></button>}
          </article>
        })}</div>}
        {uploadable && <button className="button primary upload-submit" onClick={() => void startUploads()} disabled={uploading || !auth.session}><Upload size={15}/>{uploading ? 'Uploading files…' : `Upload ${rows.filter(row => row.stage === 'ready' && row.file).length} file${rows.filter(row => row.stage === 'ready' && row.file).length === 1 ? '' : 's'}`}</button>}
      </section>
      <aside className="document-aside"><div className="panel formats-panel"><span className="aside-icon"><FileText size={17}/></span><h3>Supported formats</h3>{[['Markdown', '.md'], ['Plain text', '.txt'], ['Microsoft Word', '.docx'], ['PDF document', '.pdf'], ['Excel workbook', '.xlsx'], ['Excel 97–2003', '.xls'], ['CSV data', '.csv']].map(([label, extension]) => {const Icon = ['.xlsx', '.xls', '.csv'].includes(extension) ? FileSpreadsheet : FileText;return <div className="format-row active-format" key={extension}><Icon size={16}/><span><b>{label}</b><small>{extension} · Supported</small></span><CheckCircle2 size={16}/></div>})}<div className="format-row future"><FileText size={16}/><span><b>Legacy Word</b><small>.doc · Not supported by the backend</small></span><span className="planned">Unavailable</span></div></div><div className="tip-card"><div className="tip-heading"><CheckCircle2 size={15}/> Processing stages</div><p>Upload transfer and backend ingestion have separate progress. A file is marked Indexed only after the backend reports completion.</p></div></aside>
    </div>
  </>
}
