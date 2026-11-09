import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, type CreatedJob } from '../../lib/api/client'
import { DocumentUpload } from './DocumentUpload'

vi.mock('../../lib/sse/job-events', () => ({ subscribeJobEvents: () => () => undefined }))
vi.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({ session: { accessToken: 'synthetic-test-token', identity: { tenantId: 'tenant-test', userId: 'user-test', role: 'MEMBER' } } }) }))

const jobIds = [
  '3c9ff88b-5188-4059-b14d-8f2f2714ea77',
  'a3c9ff88b-5188-4059-b14d-8f2f2714ea78',
  'b3c9ff88b-5188-4059-b14d-8f2f2714ea79',
  'c3c9ff88b-5188-4059-b14d-8f2f2714ea80',
  'd3c9ff88b-5188-4059-b14d-8f2f2714ea81',
  'e3c9ff88b-5188-4059-b14d-8f2f2714ea82',
  'f3c9ff88b-5188-4059-b14d-8f2f2714ea83',
]
const completedJob = (jobId: string) => ({
  jobId, documentId: jobId, status: 'ready' as const, progress: { processed: 1, total: 1, percent: 100 },
  createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:01:00.000Z', attempt: 1,
})
const acceptedJob = (jobId: string, filename: string): CreatedJob => ({
  jobId, documentId: jobId, status: 'queued', duplicate: false, filename,
  progress: { processed: 0, total: null, percent: null },
  document: { id: jobId, jobId, fileName: filename, sizeBytes: 12, uploadedAt: '2026-11-02T10:00:00.000Z', uploadedBy: '', status: 'queued', active: false, downloadAvailable: false },
})

function renderUpload() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={queryClient}><DocumentUpload/></QueryClientProvider>)
  return { ...view, queryClient }
}

afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks() })

describe('document upload workspace', () => {
  it('accepts all backend-supported formats through independent file requests', async () => {
    const names = ['notes.md', 'report.docx', 'notes.txt', 'workbook.xlsx', 'data.pdf', 'legacy.xls', 'table.csv']
    const fileJobIds = new Map(names.map((name, index) => [name, jobIds[index]!]))
    const upload = vi.spyOn(api, 'upload').mockImplementation(async file => acceptedJob(fileJobIds.get(file.name)!, file.name))
    vi.spyOn(api, 'job').mockImplementation(async id => completedJob(id))
    const { container } = renderUpload()
    const files = [
      new File(['synthetic markdown'], 'notes.md', { type: 'text/markdown' }),
      new File(['synthetic document'], 'report.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      new File(['synthetic text'], 'notes.txt', { type: 'text/plain' }),
      new File(['synthetic workbook'], 'workbook.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      new File(['synthetic pdf'], 'data.pdf', { type: 'application/pdf' }),
      new File(['synthetic legacy sheet'], 'legacy.xls', { type: 'application/vnd.ms-excel' }),
      new File(['a,b\n1,2'], 'table.csv', { type: 'text/csv' }),
    ]
    const input = container.querySelector('input[type="file"]')!
    expect(input.getAttribute('accept')).toContain('.md')
    expect(input.getAttribute('accept')).toContain('.docx')
    expect(input.getAttribute('accept')).toContain('.txt')
    expect(input.getAttribute('accept')).toContain('.xlsx')
    expect(input.getAttribute('accept')).toContain('.pdf')
    expect(input.getAttribute('accept')).toContain('.xls')
    expect(input.getAttribute('accept')).toContain('.csv')
    fireEvent.change(input, { target: { files } })
    fireEvent.click(await screen.findByRole('button', { name: 'Upload 7 files' }))
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(7))
    expect(upload.mock.calls.map(call => call[0].name)).toEqual(names)
    await waitFor(() => expect([...document.querySelectorAll('.batch-upload-item')].filter(row => row.textContent?.includes('Ready'))).toHaveLength(7))
  })

  it('continues other files when one upload request fails', async () => {
    vi.spyOn(api, 'upload')
      .mockResolvedValueOnce(acceptedJob(jobIds[0]!, 'notes.md'))
      .mockRejectedValueOnce(new Error('Synthetic upload failure'))
    vi.spyOn(api, 'job').mockImplementation(async id => completedJob(id))
    const { container } = renderUpload()
    const files = [
      new File(['synthetic markdown'], 'notes.md', { type: 'text/markdown' }),
      new File(['synthetic text'], 'notes.txt', { type: 'text/plain' }),
    ]
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } })
    fireEvent.click(await screen.findByRole('button', { name: 'Upload 2 files' }))
    await waitFor(() => expect([...document.querySelectorAll('.batch-upload-item')].some(row => row.textContent?.includes('Synthetic upload failure'))).toBe(true))
    await waitFor(() => expect([...document.querySelectorAll('.batch-upload-item')].some(row => row.textContent?.includes('Ready'))).toBe(true))
  })

  it('shows a backend 500 and never starts job polling after upload rejection', async () => {
    const upload = vi.spyOn(api, 'upload').mockRejectedValue(new ApiError('The backend database needs migration 202611070002_document_versions.', 500, 'P2022'))
    const job = vi.spyOn(api, 'job')
    const { container } = renderUpload()
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['synthetic'], 'notes.md', { type: 'text/markdown' })] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Upload 1 file' }))
    expect(await screen.findByText(/P2022.*HTTP 500/)).toBeInTheDocument()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(job).not.toHaveBeenCalled()
    expect(container.querySelector('.progress-track')).not.toBeInTheDocument()
  })

  it('uses stagePercent with unit counters and stays indeterminate when counters are absent', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue(acceptedJob(jobIds[0]!, 'notes.md'))
    vi.spyOn(api, 'job').mockResolvedValue({
      ...completedJob(jobIds[0]!), status: 'processing', progress: { processed: 0, total: null, percent: null },
      stage: 'embedding', progressDetails: { stage: 'embedding', status: 'processing', stagePercent: 42, overallPercent: null, completedUnits: 2, totalUnits: 5, unit: 'chunks', attempt: 1, retryCount: 0, startedAt: null, finishedAt: null, elapsedMs: null, etaMs: null, stages: [] },
    })
    const { container } = renderUpload()
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['synthetic'], 'notes.md', { type: 'text/markdown' })] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Upload 1 file' }))
    const progress = await screen.findByRole('progressbar', { name: 'Ingestion progress for notes.md' })
    await waitFor(() => expect(progress).toHaveAttribute('aria-valuenow', '42'))
    expect(container.textContent).toContain('2 / 5 chunks')
  })

  it('stops ingestion progress when the backend reports the completed stage without percentages', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue(acceptedJob(jobIds[0]!, 'finished.docx'))
    vi.spyOn(api, 'job').mockResolvedValue({
      ...completedJob(jobIds[0]!),
      status: 'processing',
      progress: { processed: 0, total: null, percent: null },
      stage: 'completed',
      progressDetails: { stage: 'completed', status: 'processing', stagePercent: null, overallPercent: null, completedUnits: null, totalUnits: null, unit: null, attempt: 1, retryCount: 0, startedAt: null, finishedAt: null, elapsedMs: null, etaMs: null, stages: [] },
    })
    const { container } = renderUpload()
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['synthetic'], 'finished.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Upload 1 file' }))
    const progress = await screen.findByRole('progressbar', { name: 'Ingestion progress for finished.docx' })
    await waitFor(() => expect(progress).toHaveAttribute('aria-valuenow', '100'))
    expect(container.textContent).toContain('Ready')
    expect(container.textContent).toContain('Ingestion · Ready · 100%')
    expect(progress).not.toHaveClass('indeterminate')
  })

  it('rejects legacy DOC and oversized files with clear validation errors', async () => {
    const { container } = renderUpload()
    const rejected = [
      new File(['x'], 'old.doc', { type: 'application/msword' }),
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    ]
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: rejected } })
    await waitFor(() => expect([...container.querySelectorAll('.form-error')].map(node => node.textContent).join(' ')).toContain('old.doc'))
    const rejectionText = [...container.querySelectorAll('.form-error')].map(node => node.textContent).join(' ')
    expect(rejectionText).toContain('old.doc')
    expect(rejectionText).toContain('Save this document as .docx')
    expect(rejectionText).toContain('large.xlsx')
    expect(rejectionText).toContain('10 MiB default per-file limit')
    expect(screen.queryByRole('button', { name: /Upload \d+ files?/ })).not.toBeInTheDocument()
  })
})
