# SitePilot AI Frontend

React/Vite frontend for the SitePilot Mastra backend at `/Users/ali/Downloads/sitepilot-mastra-starter`.

## Run locally

```sh
cd /Users/ali/Downloads/sitepilot-mastra-starter
pnpm dev

# In another terminal
cd /Users/ali/Desktop/ic-agent
pnpm install
pnpm dev --host 127.0.0.1
```

Vite proxies `/api` and `/health` to `http://127.0.0.1:3220` by default. Set `VITE_API_PROXY_TARGET` to change the local target, or set `VITE_API_BASE_URL` to a browser-reachable API origin. Vite variables are public; never put signing keys, passwords, or tokens in them.

## Backend integration

The frontend uses the backend controllers and service DTOs, because the OpenAPI document does not define response schemas.

- Authentication: `POST /api/auth/login`, `/register`, `/refresh`, and `/logout`. Access JWTs are held in memory. Refresh uses the backend's HttpOnly cookie and `credentials: include`; the frontend never reads or stores it. A single refresh is attempted after a 401. Development auth does not exist in the frontend.
- Documents: `GET /api/documents`, `GET /api/documents/:id`, `POST /api/documents/upload` (`file` field), and `POST /api/documents/upload-batch` (`files` field). Upload responses are queued, not indexed.
- Upload limits: backend defaults are 10 MiB per file, 10 files and 50 MiB total per batch. Backend configuration may override these values. Supported extensions are `.md`, `.txt`, `.docx`, `.pdf`, `.xlsx`, `.xls`, and `.csv`; `.doc` is unsupported. The server remains authoritative for validation.
- Jobs: `GET /api/jobs/:jobId`, `GET /api/jobs/:jobId/events`, and `POST /api/jobs/:jobId/cancel`. Job snapshots are polled; SSE stage IDs are persisted and resumed with `Last-Event-ID`. Completed state is shown only for backend `ready` (or legacy `completed`) status.
- Search: `POST /api/documents/search` with `{ query, limit? }`; citations are rendered from returned hit metadata.
- Agent: `POST /api/agent/conversations`, `GET /api/agent/conversations/:id`, `PATCH /api/agent/conversations/:id` with `{ title }`, `DELETE /api/agent/conversations/:id`, and POST SSE `/api/agent/stream`. Rename and soft-delete are owner and tenant scoped by the backend. Deletion hides the conversation while retaining its messages. The frontend removes deleted IDs from its tenant/user-scoped session list. Only final `done` answers and validated source metadata become persisted UI messages/citations. Conversation IDs are remembered in session storage because the backend does not expose a list endpoint.
- Worker monitoring: `/api/admin/workers/{overview,health,jobs,metrics,events}` and `/jobs/:jobId`; navigation and requests are limited to `TENANT_ADMIN` and `SUPER_ADMIN`. Counts are labeled as retained BullMQ jobs.

The inspected backend does not expose search-history, conversation listing, document download, or secure source-preview routes. The frontend does not synthesize those APIs or generate source previews. There is no separate development identity picker; developers sign in with an account recognized by the backend.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Automated frontend tests use mock transport fixtures matching the inspected backend DTOs. Live backend authentication, upload, SSE, and Agent behavior still require a running backend and valid test account; the tests do not claim live service verification.
