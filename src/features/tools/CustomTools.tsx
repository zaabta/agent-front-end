import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  FileJson2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  api,
  ApiError,
  type CustomTool,
  type CustomToolPayload,
} from "../../lib/api/client";
import { useAuth } from "../../lib/auth/AuthProvider";
import "./CustomTools.css";

type Panel =
  | { kind: "create" }
  | { kind: "edit" | "detail" | "test"; toolId: string }
  | null;
type Draft = {
  name: string;
  displayName: string;
  description: string;
  connectionProfile: string;
  path: string;
  queryMappings: string;
  inputSchema: string;
  outputSchema: string;
  timeoutMs: string;
  maxResponseBytes: string;
  allowedResultSources: string[];
  authorizeResultSharing: boolean;
  authEnabled: boolean;
  authHeaderName: "Authorization" | "X-API-Key";
  authPrefix: string;
  authSecret: string;
};

const emptySchema =
  '{\n  "type": "object",\n  "properties": {},\n  "required": [],\n  "additionalProperties": false\n}';
const initialDraft: Draft = {
  name: "",
  displayName: "",
  description: "",
  connectionProfile: "",
  path: "",
  queryMappings: "{}",
  inputSchema: emptySchema,
  outputSchema: emptySchema,
  timeoutMs: "10000",
  maxResponseBytes: "65536",
  allowedResultSources: [],
  authorizeResultSharing: false,
  authEnabled: false,
  authHeaderName: "Authorization",
  authPrefix: "Bearer ",
  authSecret: "",
};

const timeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const builtInResultSources = [
  ["documentSearch", "Document search results and excerpts"],
  ["listDocuments", "Document inventory metadata"],
  ["datasetDiscovery", "Spreadsheet dataset and column metadata"],
  ["structuredDataLookup", "Spreadsheet row matches"],
  ["structuredRowLookup", "Spreadsheet row details"],
  ["structuredDataAnalytics", "Spreadsheet aggregate results"],
] as const;

function draftForTool(tool: CustomTool): Draft {
  return {
    name: tool.name,
    displayName: tool.displayName,
    description: tool.description,
    connectionProfile: tool.connectionProfile,
    path: tool.path,
    queryMappings: JSON.stringify(tool.queryMappings, null, 2),
    inputSchema: JSON.stringify(tool.inputSchema, null, 2),
    outputSchema: JSON.stringify(tool.outputSchema, null, 2),
    timeoutMs: String(tool.timeoutMs),
    maxResponseBytes: String(tool.maxResponseBytes),
    allowedResultSources: [...tool.allowedResultSources],
    authorizeResultSharing: false,
    authEnabled: tool.authSecretConfigured,
    authHeaderName: "Authorization",
    authPrefix: "Bearer ",
    authSecret: "",
  };
}

function parseObject(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function parseJsonSchema(text: string, label: string) {
  const value = parseObject(text, label);
  if (value.type !== "object" || value.additionalProperties !== false) {
    throw new Error(
      `${label} must use root type "object" and set additionalProperties to false.`,
    );
  }
  return value;
}

function ownerMessage(error: unknown) {
  if (!(error instanceof ApiError)) return "";
  if (error.code === "INSTALLATION_OWNER_NOT_CONFIGURED") {
    return "Custom tool management is unavailable because the backend has not configured INSTALLATION_OWNER_USER_ID.";
  }
  if (error.code === "INSTALLATION_OWNER_REQUIRED" || error.status === 403) {
    return "Only the configured installation owner can manage custom tools. This page is read-only for your account.";
  }
  return "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The API request failed.";
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function CustomTools() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [sampleInput, setSampleInput] = useState("{}");
  const [testResult, setTestResult] = useState<Awaited<
    ReturnType<typeof api.testCustomTool>
  > | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [permissionOverride, setPermissionOverride] = useState("");

  const account = useQuery({
    queryKey: ["auth-me", auth.session?.identity.userId],
    queryFn: ({ signal }) => api.currentAccount(signal),
    enabled: !!auth.session,
    retry: 0,
  });
  const readOnly = account.data?.role === "READ_ONLY";
  const tools = useQuery({
    queryKey: ["custom-tools"],
    queryFn: ({ signal }) => api.customTools(signal),
    enabled: !!auth.session && account.isSuccess && !readOnly,
    retry: 0,
  });
  const connections = useQuery({
    queryKey: ["custom-tool-connections"],
    queryFn: ({ signal }) => api.customToolConnections(signal),
    enabled: !!auth.session && account.isSuccess && !readOnly,
    retry: 0,
  });
  const selectedId = panel && "toolId" in panel ? panel.toolId : "";
  const selectedFromList = tools.data?.find((tool) => tool.id === selectedId);
  const detail = useQuery({
    queryKey: ["custom-tool", selectedId],
    queryFn: ({ signal }) => api.customTool(selectedId, signal),
    enabled: !!selectedId && panel?.kind === "detail",
    retry: 0,
  });
  const history = useQuery({
    queryKey: ["custom-tool-executions", selectedId, historyOffset],
    queryFn: ({ signal }) =>
      api.customToolExecutions(selectedId, 50, historyOffset, signal),
    enabled: !!selectedId && panel?.kind === "detail",
    retry: 0,
  });
  const accessIssue =
    permissionOverride ||
    (readOnly
      ? "Your account is read-only. Only the configured installation owner can manage custom tools."
      : "") ||
    ownerMessage(account.error) ||
    ownerMessage(tools.error) ||
    ownerMessage(connections.error);
  const canManage =
    !!auth.session &&
    account.isSuccess &&
    !readOnly &&
    tools.isSuccess &&
    connections.isSuccess &&
    !accessIssue;
  const profileRows = connections.data ?? [];
  const toolRows = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return (tools.data ?? []).filter(
      (tool) =>
        !normalized ||
        `${tool.displayName} ${tool.name} ${tool.description}`
          .toLowerCase()
          .includes(normalized),
    );
  }, [search, tools.data]);

  function closePanel() {
    setPanel(null);
    setDraft((current) => ({ ...current, authSecret: "" }));
    setFormError("");
  }

  function handleError(error: unknown) {
    const issue = ownerMessage(error);
    if (issue) setPermissionOverride(issue);
    setActionError(errorMessage(error));
  }

  async function refreshTools() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["custom-tools"] }),
      queryClient.invalidateQueries({ queryKey: ["custom-tool"] }),
      queryClient.invalidateQueries({ queryKey: ["custom-tool-executions"] }),
    ]);
  }

  const saveTool = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id?: string;
      payload: CustomToolPayload;
    }) =>
      id ? api.updateCustomTool(id, payload) : api.createCustomTool(payload),
    onSuccess: async (_tool, variables) => {
      setDraft((current) => ({ ...current, authSecret: "" }));
      setFormError("");
      setActionError("");
      setNotice(
        variables.id
          ? "Custom tool updated."
          : "Custom tool created. It is disabled until you enable it.",
      );
      setPanel(null);
      await refreshTools();
    },
    onError: handleError,
    onSettled: () => setDraft((current) => ({ ...current, authSecret: "" })),
  });
  const toggleTool = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.setCustomToolEnabled(id, enabled),
    onSuccess: async (_tool, variables) => {
      setActionError("");
      setNotice(
        variables.enabled
          ? "Tool enabled for the Agent Planner."
          : "Tool disabled.",
      );
      await refreshTools();
    },
    onError: handleError,
  });
  const archiveTool = useMutation({
    mutationFn: (id: string) => api.archiveCustomTool(id),
    onSuccess: async () => {
      setActionError("");
      setNotice("Custom tool archived. Its execution history is preserved.");
      if (panel?.kind === "detail") closePanel();
      await refreshTools();
    },
    onError: handleError,
  });
  const testTool = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Record<string, unknown>;
    }) => api.testCustomTool(id, input),
    onSuccess: async (result) => {
      setTestResult(result);
      setActionError("");
      await queryClient.invalidateQueries({
        queryKey: ["custom-tool-executions"],
      });
    },
    onError: handleError,
  });

  useEffect(() => {
    if (panel?.kind !== "detail") {
      setHistoryOffset(0);
    }
  }, [panel?.kind, selectedId]);

  function openCreate() {
    setDraft({ ...initialDraft });
    setFormError("");
    setPanel({ kind: "create" });
  }

  function openEdit(tool: CustomTool) {
    setDraft(draftForTool(tool));
    setFormError("");
    setPanel({ kind: "edit", toolId: tool.id });
  }

  function submitTool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    try {
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(draft.name)) {
        throw new Error(
          "Use a unique lowercase name with letters, numbers, underscores, or hyphens (up to 64 characters).",
        );
      }
      if (
        !draft.displayName.trim() ||
        draft.displayName.length > 100 ||
        draft.description.trim().length < 3 ||
        draft.description.length > 500
      ) {
        throw new Error("Enter a display name and an AI-facing description.");
      }
      if (!draft.connectionProfile)
        throw new Error("Choose an approved connection profile.");
      if (
        draft.path.length > 1000 ||
        !draft.path.startsWith("/") ||
        /[?#]/.test(draft.path) ||
        draft.path.includes("..")
      ) {
        throw new Error(
          "Enter a fixed relative path beginning with / and without query strings.",
        );
      }
      const mappings = parseObject(draft.queryMappings, "Query mappings");
      if (Object.values(mappings).some((value) => typeof value !== "string")) {
        throw new Error(
          "Each query mapping value must be an input property name.",
        );
      }
      const inputSchema = parseJsonSchema(draft.inputSchema, "Input schema");
      const outputSchema = parseJsonSchema(draft.outputSchema, "Output schema");
      const timeoutMs = Number(draft.timeoutMs);
      const maxResponseBytes = Number(draft.maxResponseBytes);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30000)
        throw new Error(
          "Timeout must be a whole number between 500 and 30,000 milliseconds.",
        );
      if (
        !Number.isInteger(maxResponseBytes) ||
        maxResponseBytes < 256 ||
        maxResponseBytes > 1000000
      )
        throw new Error(
          "Response limit must be a whole number between 256 and 1,000,000 bytes.",
        );
      if (draft.authEnabled && !draft.authSecret.trim()) {
        throw new Error(
          "Enter a new credential to configure or rotate authentication. Stored credentials are never shown.",
        );
      }
      if (
        draft.allowedResultSources.length > 0 &&
        !draft.authorizeResultSharing
      ) {
        throw new Error(
          "Confirm that the selected workspace results may be sent to this API.",
        );
      }
      const payload: CustomToolPayload = {
        name: draft.name,
        displayName: draft.displayName.trim(),
        description: draft.description.trim(),
        connectionProfile: draft.connectionProfile,
        path: draft.path,
        queryMappings: mappings as Record<string, string>,
        allowedResultSources: draft.allowedResultSources,
        inputSchema,
        outputSchema,
        ...(draft.authEnabled
          ? {
              auth: {
                headerName: draft.authHeaderName,
                prefix: draft.authPrefix,
                secret: draft.authSecret,
              },
            }
          : {}),
        timeoutMs,
        maxResponseBytes,
      };
      saveTool.mutate({
        id: panel?.kind === "edit" ? panel.toolId : undefined,
        payload,
      });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  function runTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    try {
      if (!selectedId) throw new Error("Select a custom tool to test.");
      testTool.mutate({
        id: selectedId,
        input: parseObject(sampleInput, "Sample input"),
      });
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  function openTest(tool: CustomTool) {
    setSampleInput("{}");
    setTestResult(null);
    setActionError("");
    setPanel({ kind: "test", toolId: tool.id });
  }

  function archive(tool: CustomTool) {
    if (
      canManage &&
      window.confirm(
        `Archive “${tool.displayName}”? It will be disabled and removed from the registry.`,
      )
    ) {
      archiveTool.mutate(tool.id);
    }
  }

  async function retryOwnerQueries() {
    setPermissionOverride("");
    const accountResult = await account.refetch();
    if (accountResult.data?.role === "READ_ONLY") return;
    const results = await Promise.all([tools.refetch(), connections.refetch()]);
    const issue = results
      .map((result) => ownerMessage(result.error))
      .find(Boolean);
    setPermissionOverride(issue ?? "");
  }

  const panelTool = detail.data ?? selectedFromList;
  const detailLoading = panel?.kind === "detail" && detail.isPending;
  const queryPermissionIssue =
    ownerMessage(account.error) ||
    ownerMessage(tools.error) ||
    ownerMessage(connections.error);

  return (
    <main className="custom-tools-page">
      <header className="custom-tools-header">
        <div>
          <div className="custom-tools-eyebrow">AGENT STUDIO</div>
          <h1>Tools</h1>
          <p>Build safe HTTP integrations for the Agent Planner.</p>
        </div>
        <button
          className="button primary custom-tools-add"
          type="button"
          onClick={openCreate}
          disabled={!canManage}
        >
          <Plus size={16} /> Add Tool
        </button>
      </header>

      {!auth.session ? (
        <div className="custom-tools-message">
          <LockKeyhole size={18} />
          <span>Sign in to view custom tools.</span>
        </div>
      ) : account.isLoading ||
        (!readOnly && (tools.isLoading || connections.isLoading)) ? (
        <div
          className="custom-tools-skeleton"
          aria-label="Loading custom tools"
        >
          <div />
          <div />
          <div />
        </div>
      ) : accessIssue || queryPermissionIssue ? (
        <div className="custom-tools-permission" role="alert">
          <ShieldCheck size={22} />
          <div>
            <h2>{accessIssue || queryPermissionIssue}</h2>
            <p>
              Management actions are disabled. Access is checked by the backend
              for the configured installation owner.
            </p>
          </div>
          <button
            className="button secondary"
            type="button"
            onClick={() => void retryOwnerQueries()}
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : account.isError || tools.isError || connections.isError ? (
        <div className="custom-tools-error" role="alert">
          <AlertCircle size={18} />
          <span>
            {errorMessage(account.error ?? tools.error ?? connections.error)}
          </span>
          <button
            className="button secondary"
            type="button"
            onClick={() => void retryOwnerQueries()}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="custom-tools-planner-note">
            <Sparkles size={16} />
            <span>
              Enabled custom tools are available to the existing Agent Planner.
            </span>
            <Link to="/agent">
              Open AI Agent <ArrowRight size={14} />
            </Link>
          </div>
          {notice && (
            <p className="custom-tools-notice" role="status">
              <CheckCircle2 size={15} />
              {notice}
              <button
                type="button"
                onClick={() => setNotice("")}
                aria-label="Dismiss notice"
              >
                <X size={14} />
              </button>
            </p>
          )}
          {actionError && (
            <div className="custom-tools-error" role="alert">
              <AlertCircle size={17} />
              <span>{accessIssue || actionError}</span>
              <button
                type="button"
                onClick={() => setActionError("")}
                aria-label="Dismiss error"
              >
                <X size={15} />
              </button>
            </div>
          )}
          <section className="custom-tools-section">
            <div className="custom-tools-section-heading">
              <div>
                <h2>Custom tools</h2>
                <p>
                  {toolRows.length} {toolRows.length === 1 ? "tool" : "tools"}{" "}
                  configured
                </p>
              </div>
              {!!tools.data?.length && (
                <label className="custom-tools-search">
                  <Search size={15} />
                  <input
                    aria-label="Search custom tools"
                    placeholder="Search tools"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              )}
            </div>
            {tools.data?.length === 0 ? (
              <div className="custom-tools-empty">
                <span className="custom-tools-empty-icon">
                  <Wrench size={23} />
                </span>
                <h2>No custom tools yet</h2>
                <p>
                  Connect a trusted API through an approved profile, then choose
                  when the Agent can use it.
                </p>
                <button
                  className="button primary"
                  type="button"
                  onClick={openCreate}
                  disabled={!canManage}
                >
                  <Plus size={15} /> Add Tool
                </button>
              </div>
            ) : toolRows.length === 0 ? (
              <div className="custom-tools-empty compact">
                <Search size={18} />
                <p>No custom tools match “{search}”.</p>
              </div>
            ) : (
              <div className="custom-tool-list">
                {toolRows.map((tool) => {
                  const profile = profileRows.find(
                    (row) => row.id === tool.connectionProfile,
                  );
                  return (
                    <article className="custom-tool-card" key={tool.id}>
                      <div className="custom-tool-card-icon">
                        <Code2 size={19} />
                      </div>
                      <div className="custom-tool-main">
                        <div className="custom-tool-title-row">
                          <h3>{tool.displayName}</h3>
                          <span
                            className={`custom-tool-status ${tool.enabled ? "enabled" : "disabled"}`}
                          >
                            <i />
                            {tool.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                        <p>{tool.description}</p>
                        <div className="custom-tool-meta">
                          <code>{tool.name}</code>
                          <span>HTTP GET</span>
                          <span>{profile?.host ?? tool.connectionProfile}</span>
                          <span>
                            Updated{" "}
                            {timeFormat.format(new Date(tool.updatedAt))}
                          </span>
                          {tool.authSecretConfigured && (
                            <span className="custom-tool-auth-state">
                              <LockKeyhole size={12} />
                              Credential configured
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="custom-tool-actions">
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() =>
                            setPanel({ kind: "detail", toolId: tool.id })
                          }
                        >
                          <Eye size={14} /> Details
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={!canManage}
                          onClick={() => openTest(tool)}
                        >
                          <Activity size={14} /> Test
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={!canManage || toggleTool.isPending}
                          onClick={() =>
                            toggleTool.mutate({
                              id: tool.id,
                              enabled: !tool.enabled,
                            })
                          }
                        >
                          {tool.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          className="custom-tool-more"
                          aria-label={`Edit ${tool.displayName}`}
                          disabled={!canManage}
                          onClick={() => openEdit(tool)}
                        >
                          Edit
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {panel && (
        <div
          className="custom-tool-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePanel();
          }}
        >
          <section
            className="custom-tool-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={
              panel.kind === "create"
                ? "Add custom tool"
                : `${panel.kind} custom tool`
            }
          >
            <div className="custom-tool-drawer-header">
              <div>
                <span>
                  {panel.kind === "create"
                    ? "NEW INTEGRATION"
                    : panel.kind === "edit"
                      ? "TOOL CONFIGURATION"
                      : panel.kind === "test"
                        ? "LIVE CONFIGURATION TEST"
                        : "CUSTOM TOOL"}
                </span>
                <h2>
                  {panel.kind === "create"
                    ? "Add a tool"
                    : (panelTool?.displayName ??
                      (detailLoading ? "Loading tool…" : "Custom tool"))}
                </h2>
              </div>
              <button
                className="custom-tool-close"
                type="button"
                onClick={closePanel}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            {panel.kind === "create" || panel.kind === "edit" ? (
              <ToolForm
                draft={draft}
                setDraft={setDraft}
                profiles={profileRows}
                existing={panel.kind === "edit" ? selectedFromList : undefined}
                error={formError}
                busy={saveTool.isPending}
                onSubmit={submitTool}
                onCancel={closePanel}
              />
            ) : panel.kind === "test" ? (
              <form className="custom-tool-test" onSubmit={runTest}>
                <div className="custom-tool-config-test-note">
                  <Activity size={15} />
                  <span>
                    This sends a real test request through the approved profile.
                    It does not represent a Planner execution.
                  </span>
                </div>
                <label htmlFor="sample-input">Sample input</label>
                <textarea
                  id="sample-input"
                  value={sampleInput}
                  onChange={(event) => setSampleInput(event.target.value)}
                  spellCheck={false}
                  rows={10}
                />
                {actionError && (
                  <p className="custom-tool-form-error" role="alert">
                    <AlertCircle size={14} />
                    {actionError}
                  </p>
                )}
                <button
                  className="button primary"
                  type="submit"
                  disabled={!canManage || testTool.isPending}
                >
                  {testTool.isPending ? (
                    <>
                      <LoaderCircle className="spin" size={15} /> Testing…
                    </>
                  ) : (
                    <>
                      <Activity size={15} /> Run configuration test
                    </>
                  )}
                </button>
                {testResult && <TestResult result={testResult} />}
              </form>
            ) : (
              <div className="custom-tool-detail">
                {detailLoading ? (
                  <div className="custom-tools-skeleton">
                    <div />
                    <div />
                  </div>
                ) : panelTool ? (
                  <>
                    {detail.isError && (
                      <div className="custom-tools-error" role="alert">
                        {errorMessage(detail.error)}
                      </div>
                    )}
                    <div className="custom-tool-detail-grid">
                      <span>Status</span>
                      <b>{panelTool.enabled ? "Enabled" : "Disabled"}</b>
                      <span>Type</span>
                      <b>HTTP GET · READ_ONLY</b>
                      <span>Connection</span>
                      <b>
                        {profileRows.find(
                          (row) => row.id === panelTool.connectionProfile,
                        )?.host ?? panelTool.connectionProfile}
                      </b>
                      <span>Path</span>
                      <code>{panelTool.path}</code>
                      <span>Authentication</span>
                      <b>
                        {panelTool.authSecretConfigured
                          ? "Credential configured · value hidden"
                          : "None"}
                      </b>
                      <span>Timeout</span>
                      <b>{panelTool.timeoutMs.toLocaleString()} ms</b>
                      <span>Response cap</span>
                      <b>{panelTool.maxResponseBytes.toLocaleString()} bytes</b>
                      <span>Updated</span>
                      <b>{timeFormat.format(new Date(panelTool.updatedAt))}</b>
                    </div>
                    <p className="custom-tool-detail-description">
                      {panelTool.description}
                    </p>
                    <div className="custom-tool-schema-preview">
                      <h3>
                        <FileJson2 size={15} /> Input schema
                      </h3>
                      <pre>{pretty(panelTool.inputSchema)}</pre>
                      <h3>
                        <FileJson2 size={15} /> Output schema
                      </h3>
                      <pre>{pretty(panelTool.outputSchema)}</pre>
                    </div>
                    <div className="custom-tool-detail-actions">
                      <button
                        className="button secondary"
                        type="button"
                        disabled={!canManage}
                        onClick={() => openEdit(panelTool)}
                      >
                        Edit configuration
                      </button>
                      <button
                        className="button primary"
                        type="button"
                        disabled={!canManage}
                        onClick={() => openTest(panelTool)}
                      >
                        Test tool
                      </button>
                      <button
                        className="button danger"
                        type="button"
                        disabled={!canManage || archiveTool.isPending}
                        onClick={() => archive(panelTool)}
                      >
                        <Trash2 size={14} /> Archive
                      </button>
                    </div>
                    <section className="custom-tool-history">
                      <div className="custom-tool-history-heading">
                        <div>
                          <h3>Execution history</h3>
                          <p>
                            Metadata only. Request and response bodies are never
                            shown.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="custom-tool-icon-button"
                          onClick={() => void history.refetch()}
                          aria-label="Refresh history"
                        >
                          <RefreshCw size={15} />
                        </button>
                      </div>
                      {history.isLoading ? (
                        <p className="custom-tool-muted">
                          Loading execution history…
                        </p>
                      ) : history.isError ? (
                        <div className="custom-tools-error" role="alert">
                          {errorMessage(history.error)}
                        </div>
                      ) : history.data?.length ? (
                        <>
                          <div className="custom-history-table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>When</th>
                                  <th>Status</th>
                                  <th>Duration</th>
                                  <th>Type</th>
                                  <th>Error category</th>
                                </tr>
                              </thead>
                              <tbody>
                                {history.data.map((row) => (
                                  <tr key={row.id}>
                                    <td>
                                      {timeFormat.format(
                                        new Date(row.createdAt),
                                      )}
                                    </td>
                                    <td>
                                      <span
                                        className={`custom-history-status ${row.success ? "success" : "failed"}`}
                                      >
                                        {row.success ? "Success" : "Failed"}
                                      </span>
                                    </td>
                                    <td>
                                      {row.latencyMs == null
                                        ? "—"
                                        : `${row.latencyMs} ms`}
                                    </td>
                                    <td>
                                      {row.isTest ? "Config test" : "Agent"}
                                    </td>
                                    <td>{row.errorCategory ?? "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="custom-history-pagination">
                            <button
                              className="button secondary"
                              type="button"
                              disabled={historyOffset === 0}
                              onClick={() =>
                                setHistoryOffset((offset) =>
                                  Math.max(0, offset - 50),
                                )
                              }
                            >
                              <ChevronLeft size={14} /> Previous
                            </button>
                            <span>
                              {history.data.length} records · offset{" "}
                              {historyOffset}
                            </span>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={history.data.length < 50}
                              onClick={() =>
                                setHistoryOffset((offset) => offset + 50)
                              }
                            >
                              Next <ChevronRight size={14} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="custom-tool-muted">
                          No execution records yet.
                        </p>
                      )}
                    </section>
                  </>
                ) : (
                  <p className="custom-tool-muted">
                    This tool is no longer available.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function ToolForm({
  draft,
  setDraft,
  profiles,
  existing,
  error,
  busy,
  onSubmit,
  onCancel,
}: {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  profiles: { id: string; host: string; trustedInternal: boolean }[];
  existing?: CustomTool;
  error: string;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const edit = !!existing;
  const authConfigured = !!existing?.authSecretConfigured;
  function update<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  return (
    <form className="custom-tool-form" onSubmit={onSubmit}>
      <p className="custom-tool-form-intro">
        Configure a bounded, read-only HTTP GET integration. Requests can only
        reach this approved profile.
      </p>
      <div className="custom-tool-form-section">
        <h3>Basic information</h3>
        <label>
          Tool name{" "}
          <input
            required
            value={draft.name}
            onChange={(event) => update("name", event.target.value)}
            placeholder="crm_contact_search"
            disabled={edit}
          />
          <small>
            Unique lowercase slug. It cannot be changed after creation.
          </small>
        </label>
        <label>
          Display name{" "}
          <input
            required
            maxLength={100}
            value={draft.displayName}
            onChange={(event) => update("displayName", event.target.value)}
            placeholder="Search CRM contacts"
          />
        </label>
        <label>
          AI-facing description{" "}
          <textarea
            required
            maxLength={500}
            rows={3}
            value={draft.description}
            onChange={(event) => update("description", event.target.value)}
            placeholder="Describe what the tool finds and when the Agent should use it."
          />
        </label>
      </div>
      <div className="custom-tool-form-section">
        <h3>HTTP connection</h3>
        <div className="custom-tool-fixed-type">
          <span>
            <Code2 size={15} /> HTTP GET
          </span>
          <span>READ_ONLY</span>
          <small>Method is fixed to prevent write operations.</small>
        </div>
        <label>
          Approved connection profile{" "}
          <select
            required
            value={draft.connectionProfile}
            onChange={(event) =>
              update("connectionProfile", event.target.value)
            }
          >
            <option value="">Choose a server-approved profile</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.id} · {profile.host}
                {profile.trustedInternal ? " · trusted internal" : ""}
              </option>
            ))}
          </select>
          {profiles.length === 0 && (
            <small>No approved profiles are configured on the backend.</small>
          )}
        </label>
        <label>
          API path{" "}
          <input
            required
            maxLength={1000}
            value={draft.path}
            onChange={(event) => update("path", event.target.value)}
            placeholder="/contacts"
          />
          <small>
            Relative to the selected profile. Do not include a host or query
            string.
          </small>
        </label>
        <label>
          Query parameter mappings{" "}
          <textarea
            className="custom-tool-code-editor compact"
            rows={4}
            spellCheck={false}
            value={draft.queryMappings}
            onChange={(event) => update("queryMappings", event.target.value)}
          />
          <small>
            JSON object mapping API query parameter names to top-level input
            properties.
          </small>
        </label>
      </div>
      <div className="custom-tool-form-section">
        <h3>Input and output</h3>
        <JsonEditor
          id="input-schema"
          label="Input JSON Schema"
          value={draft.inputSchema}
          onChange={(value) => update("inputSchema", value)}
        />
        <JsonEditor
          id="output-schema"
          label="Output JSON Schema"
          value={draft.outputSchema}
          onChange={(value) => update("outputSchema", value)}
        />
      </div>
      <div className="custom-tool-form-section">
        <h3>Workspace data sharing</h3>
        <p className="custom-tool-auth-warning">
          <ShieldCheck size={14} />
          Selected built-in results may contain document or spreadsheet data.
          They remain blocked unless you explicitly select and authorize them.
        </p>
        {builtInResultSources.map(([id, label]) => (
          <label className="custom-tool-checkbox" key={id}>
            <input
              type="checkbox"
              checked={draft.allowedResultSources.includes(id)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...new Set([...draft.allowedResultSources, id])]
                  : draft.allowedResultSources.filter((source) => source !== id);
                update("allowedResultSources", next);
                if (!next.length) update("authorizeResultSharing", false);
              }}
            />
            <span>{label}</span>
          </label>
        ))}
        {draft.allowedResultSources.length > 0 && (
          <label className="custom-tool-checkbox custom-tool-share-confirm">
            <input
              type="checkbox"
              checked={draft.authorizeResultSharing}
              onChange={(event) =>
                update("authorizeResultSharing", event.target.checked)
              }
            />
            <span>
              I authorize these selected results to be sent to this approved
              connection.
            </span>
          </label>
        )}
      </div>
      <div className="custom-tool-form-section">
        <h3>Authentication</h3>
        {authConfigured && (
          <p className="custom-tool-auth-warning">
            <LockKeyhole size={14} />
            The backend does not return the saved header or prefix. To edit this
            tool safely, either rotate its credential below or turn
            authentication off. The saved value is never revealed.
          </p>
        )}
        <label className="custom-tool-checkbox">
          <input
            type="checkbox"
            checked={draft.authEnabled}
            onChange={(event) => {
              update("authEnabled", event.target.checked);
              if (!event.target.checked) update("authSecret", "");
            }}
          />
          <span>Add or replace a server-encrypted credential</span>
        </label>
        {draft.authEnabled && (
          <div className="custom-tool-auth-fields">
            <label>
              Header name{" "}
              <select
                value={draft.authHeaderName}
                onChange={(event) => {
                  const headerName = event.target
                    .value as Draft["authHeaderName"];
                  setDraft((current) => ({
                    ...current,
                    authHeaderName: headerName,
                    authPrefix: headerName === "X-API-Key" ? "" : "Bearer ",
                  }));
                }}
              >
                <option value="Authorization">Authorization</option>
                <option value="X-API-Key">X-API-Key</option>
              </select>
            </label>
            <label>
              Prefix{" "}
              <input
                value={draft.authPrefix}
                onChange={(event) => update("authPrefix", event.target.value)}
                placeholder="Bearer "
              />
            </label>
            <label className="custom-tool-secret-field">
              {authConfigured
                ? "New credential (required to rotate)"
                : "Credential"}
              <input
                type="password"
                autoComplete="new-password"
                value={draft.authSecret}
                onChange={(event) => update("authSecret", event.target.value)}
                placeholder="Enter credential"
              />
            </label>
          </div>
        )}
        <small>
          Only Authorization and X-API-Key headers are supported. Credentials
          are write-only and never stored in browser storage.
        </small>
      </div>
      <div className="custom-tool-form-section">
        <h3>Safety limits</h3>
        <div className="custom-tool-number-grid">
          <label>
            Timeout (ms)
            <input
              required
              type="number"
              step="1"
              min="500"
              max="30000"
              value={draft.timeoutMs}
              onChange={(event) => update("timeoutMs", event.target.value)}
            />
          </label>
          <label>
            Maximum response (bytes)
            <input
              required
              type="number"
              step="1"
              min="256"
              max="1000000"
              value={draft.maxResponseBytes}
              onChange={(event) =>
                update("maxResponseBytes", event.target.value)
              }
            />
          </label>
        </div>
      </div>
      {error && (
        <p className="custom-tool-form-error" role="alert">
          <AlertCircle size={14} />
          {error}
        </p>
      )}
      <div className="custom-tool-form-footer">
        <button
          type="button"
          className="button secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={busy || profiles.length === 0}
        >
          {busy ? (
            <>
              <LoaderCircle className="spin" size={15} /> Saving…
            </>
          ) : edit ? (
            <>
              <Check size={15} /> Save changes
            </>
          ) : (
            <>
              <Plus size={15} /> Create disabled tool
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function JsonEditor({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="custom-tool-json-editor" htmlFor={id}>
      {label}
      <span className="custom-tool-json-hint">
        Root must be an object; additionalProperties must be false.
      </span>
      <textarea
        id={id}
        className="custom-tool-code-editor"
        spellCheck={false}
        rows={9}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="custom-tool-json-example">
        Example:{" "}
        <code>
          {
            '{ "type": "object", "properties": {}, "required": [], "additionalProperties": false }'
          }
        </code>
      </span>
    </label>
  );
}

function TestResult({
  result,
}: {
  result: Awaited<ReturnType<typeof api.testCustomTool>>;
}) {
  return (
    <section
      className={`custom-tool-test-result ${result.success ? "success" : "failed"}`}
      aria-live="polite"
    >
      <div className="custom-tool-test-result-heading">
        {result.success ? (
          <CheckCircle2 size={16} />
        ) : (
          <AlertCircle size={16} />
        )}
        <b>
          {result.success
            ? "Configuration test passed"
            : "Configuration test failed"}
        </b>
        <span>{result.durationMs} ms</span>
      </div>
      {result.errorCategory && (
        <p>
          Error category: <code>{result.errorCategory}</code>
        </p>
      )}
      {result.sampleOutput !== undefined && (
        <>
          <h3>Sanitized sample output</h3>
          <pre>{pretty(result.sampleOutput)}</pre>
        </>
      )}
      <small>
        Returned by the backend test endpoint. This is not an Agent Planner
        execution.
      </small>
    </section>
  );
}
