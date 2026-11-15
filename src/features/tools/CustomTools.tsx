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
type SchemaParameter = {
  id: string;
  name: string;
  type: "string" | "number" | "integer" | "boolean";
  required: boolean;
  description: string;
  queryParameter: string;
};
type AuthMode = "none" | "Authorization" | "X-API-Key" | "unresolved";
type Draft = {
  name: string;
  slugCustomized: boolean;
  displayName: string;
  description: string;
  endpoint: string;
  parameters: SchemaParameter[];
  queryMappings: string;
  inputSchema: string;
  outputSchema: string;
  rawInputSchema: boolean;
  rawOutputSchema: boolean;
  timeoutMs: string;
  maxResponseBytes: string;
  authMode: AuthMode;
  authPrefix: string;
  authSecret: string;
};

const emptySchema =
  '{\n  "type": "object",\n  "properties": {},\n  "required": [],\n  "additionalProperties": false\n}';
const openOutputSchema =
  '{\n  "type": "object",\n  "properties": {},\n  "required": [],\n  "additionalProperties": true\n}';
const initialDraft: Draft = {
  name: "",
  slugCustomized: false,
  displayName: "",
  description: "",
  endpoint: "",
  parameters: [],
  queryMappings: "{}",
  inputSchema: emptySchema,
  outputSchema: openOutputSchema,
  rawInputSchema: false,
  rawOutputSchema: false,
  timeoutMs: "10000",
  maxResponseBytes: "65536",
  authMode: "none",
  authPrefix: "Bearer ",
  authSecret: "",
};

const timeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function isParameterSchema(schema: Record<string, unknown>) {
  const properties = schema.properties;
  return (
    schema.type === "object" &&
    schema.additionalProperties === false &&
    properties !== null &&
    typeof properties === "object" &&
    !Array.isArray(properties) &&
    Object.keys(schema).every((key) =>
      ["type", "properties", "required", "additionalProperties"].includes(
        key,
      ),
    ) &&
    Object.values(properties as Record<string, unknown>).every((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
      const parameter = value as Record<string, unknown>;
      return (
        ["string", "number", "integer", "boolean"].includes(
          String(parameter.type),
        ) &&
        Object.keys(parameter).every((key) =>
          ["type", "description"].includes(key),
        )
      );
    })
  );
}

function draftForTool(tool: CustomTool): Draft {
  const isDefaultOutput =
    tool.outputSchema.additionalProperties === true &&
    Object.keys((tool.outputSchema.properties as object) ?? {}).length === 0;
  return {
    name: tool.name,
    slugCustomized: true,
    displayName: tool.displayName,
    description: tool.description,
    endpoint: tool.endpoint ?? "",
    parameters: tool.parameters.map((parameter, index) => ({
      ...parameter,
      id: `${index}-${parameter.name}`,
      description: parameter.description ?? "",
    })),
    queryMappings: JSON.stringify(tool.queryMappings, null, 2),
    inputSchema: JSON.stringify(tool.inputSchema, null, 2),
    outputSchema: JSON.stringify(tool.outputSchema, null, 2),
    rawInputSchema: !isParameterSchema(tool.inputSchema),
    rawOutputSchema: !isDefaultOutput,
    timeoutMs: String(tool.timeoutMs),
    maxResponseBytes: String(tool.maxResponseBytes),
    authMode: tool.authSecretConfigured ? "unresolved" : "none",
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

const allowedSchemaKeywords = new Set([
  "type",
  "title",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

function validateSchemaContract(
  schema: Record<string, unknown>,
  label: string,
  allowOpenOutput = false,
) {
  const check = (value: unknown, depth = 0): boolean => {
    if (
      depth > 8 ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      return false;
    const item = value as Record<string, unknown>;
    if (Object.keys(item).some((key) => !allowedSchemaKeywords.has(key)))
      return false;
    if (item.type === "object") {
      if (
        !item.properties ||
        typeof item.properties !== "object" ||
        Array.isArray(item.properties)
      )
        return false;
      const properties = item.properties as Record<string, unknown>;
      const openDefault =
        allowOpenOutput &&
        depth === 0 &&
        item.additionalProperties === true &&
        Object.keys(properties).length === 0;
      if (
        (!openDefault && item.additionalProperties !== false) ||
        Object.keys(properties).length > 40 ||
        !Object.values(properties).every((child) => check(child, depth + 1))
      )
        return false;
      if (
        item.required !== undefined &&
        (!Array.isArray(item.required) ||
          !item.required.every(
            (key) => typeof key === "string" && Object.hasOwn(properties, key),
          ))
      )
        return false;
    } else if (item.type === "array") {
      if (!check(item.items, depth + 1)) return false;
    } else if (
      !["string", "number", "integer", "boolean", "null"].includes(
        String(item.type),
      )
    ) {
      return false;
    }
    return true;
  };
  if (
    schema.type !== "object" ||
    JSON.stringify(schema).length > 12_000 ||
    !check(schema)
  ) {
    throw new Error(
      `${label} must use supported JSON Schema keywords, an object root with supported properties, at most 40 properties per object, and no more than 8 levels.`,
    );
  }
}

function parseJsonSchema(text: string, label: string, allowOpenOutput = false) {
  const value = parseObject(text, label);
  validateSchemaContract(value, label, allowOpenOutput);
  return value;
}

function schemaFromParameters(parameters: SchemaParameter[]) {
  if (parameters.length > 20)
    throw new Error("The backend supports up to 20 parameters.");
  const properties = Object.create(null) as Record<string, unknown>;
  const required: string[] = [];
  const queryNames = new Set<string>();
  const queryMappings: Record<string, string> = {};
  for (const parameter of parameters) {
    const name = parameter.name.trim();
    const queryParameter = parameter.queryParameter.trim() || name;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))
      throw new Error("Parameter names must start with a letter and use only letters, numbers, and underscores.");
    if (Object.hasOwn(properties, name))
      throw new Error(`Parameter name “${name}” is used more than once.`);
    if (!/^[A-Za-z0-9_.~-]{1,80}$/.test(queryParameter))
      throw new Error(`“${queryParameter}” is not a valid API query parameter name.`);
    if (queryNames.has(queryParameter))
      throw new Error(`Query parameter “${queryParameter}” is used more than once.`);
    if (parameter.description.length > 300)
      throw new Error(`The description for “${name}” must be at most 300 characters.`);
    properties[name] = {
      type: parameter.type,
      ...(parameter.description.trim()
        ? { description: parameter.description.trim() }
        : {}),
    };
    queryNames.add(queryParameter);
    queryMappings[queryParameter] = name;
    if (parameter.required) required.push(name);
  }
  const schema = {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
  validateSchemaContract(schema, "Generated input schema");
  return { schema, queryMappings };
}

function slugFromDisplayName(displayName: string) {
  const slug = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (!slug) return "custom_tool";
  return /^[a-z]/.test(slug) ? slug : `tool_${slug}`.slice(0, 64);
}

function validateEndpoint(endpoint: string) {
  if (!endpoint || endpoint.length > 2000)
    throw new Error("Enter a full HTTPS endpoint up to 2,000 characters.");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Enter a valid full HTTPS endpoint.");
  }
  const authorityEnd = endpoint.indexOf("/", endpoint.indexOf("://") + 3);
  const rawPath = authorityEnd < 0 ? "/" : endpoint.slice(authorityEnd);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !hostname ||
    hostname.endsWith(".") ||
    hostname === "metadata.google.internal" ||
    /[%\\\u0000-\u0020]/.test(rawPath) ||
    rawPath.split("/").some((segment) => segment === "." || segment === "..") ||
    url.pathname !== (rawPath || "/")
  )
    throw new Error("Use an HTTPS endpoint without credentials, query, fragment, or dot-segment path.");
  return `${url.origin}${url.pathname}`;
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
  if (error instanceof ApiError && error.code)
    return `${error.message} (${error.code})`;
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
  const [creationStep, setCreationStep] = useState<"configure" | "review">(
    "configure",
  );
  const [reviewPayload, setReviewPayload] = useState<CustomToolPayload | null>(
    null,
  );
  const [justCreatedToolId, setJustCreatedToolId] = useState("");
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [sampleInput, setSampleInput] = useState("{}");
  const [testResult, setTestResult] = useState<Awaited<
    ReturnType<typeof api.testCustomTool>
  > | null>(null);
  const [testResultToolId, setTestResultToolId] = useState("");
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
    ownerMessage(tools.error);
  const canManage =
    !!auth.session &&
    account.isSuccess &&
    !readOnly &&
    tools.isSuccess &&
    !accessIssue;
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
    setReviewPayload(null);
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
    onSuccess: async (tool, variables) => {
      setDraft((current) => ({ ...current, authSecret: "" }));
      setFormError("");
      setActionError("");
      setNotice(
        variables.id
          ? "Custom tool updated."
          : "Custom tool created. Test it before enabling it.",
      );
      setReviewPayload(null);
      if (variables.id) {
        setTestResult(null);
        setTestResultToolId("");
        setPanel(null);
      }
      else {
        setJustCreatedToolId(tool.id);
        setTestResult(null);
        setTestResultToolId("");
        setPanel({ kind: "detail", toolId: tool.id });
      }
      await refreshTools();
    },
    onError: (error, variables) => {
      handleError(error);
      if (!variables.id) {
        setFormError(errorMessage(error));
        setCreationStep("configure");
        setReviewPayload(null);
      }
    },
    onSettled: (_data, _error, variables) => {
      setDraft((current) => ({ ...current, authSecret: "" }));
      if (!variables.id) setReviewPayload(null);
    },
  });
  const toggleTool = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.setCustomToolEnabled(id, enabled),
    onSuccess: async (_tool, variables) => {
      setActionError("");
      setTestResult(null);
      setTestResultToolId("");
      setNotice(
        variables.enabled
          ? "Tool enabled for the Agent Planner."
          : "Tool disabled.",
      );
      if (variables.enabled && panel?.kind === "test")
        setPanel({ kind: "detail", toolId: variables.id });
      await refreshTools();
    },
    onError: handleError,
  });
  const archiveTool = useMutation({
    mutationFn: (id: string) => api.archiveCustomTool(id),
    onSuccess: async () => {
      setActionError("");
      setNotice("Custom tool deleted. Its execution history is preserved.");
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
    onSuccess: async (result, variables) => {
      setTestResult(result);
      setTestResultToolId(variables.id);
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
    setCreationStep("configure");
    setReviewPayload(null);
    setPanel({ kind: "create" });
  }

  function openEdit(tool: CustomTool) {
    setDraft(draftForTool(tool));
    setFormError("");
    setReviewPayload(null);
    setTestResult(null);
    setTestResultToolId("");
    setPanel({ kind: "edit", toolId: tool.id });
  }

  function submitTool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    try {
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(draft.name)) {
        throw new Error(
          "Use a unique lowercase slug with letters, numbers, underscores, or hyphens (up to 64 characters).",
        );
      }
      if (
        !draft.displayName.trim() ||
        draft.displayName.length > 100 ||
        draft.description.trim().length < 3 ||
        draft.description.length > 500
      ) {
        throw new Error("Enter a tool name and an AI-facing description.");
      }
      const endpoint = validateEndpoint(draft.endpoint.trim());
      let parameters: CustomToolPayload["parameters"];
      let rawInputSchema: Record<string, unknown> | undefined;
      let rawQueryMappings: Record<string, string> | undefined;
      if (draft.rawInputSchema) {
        rawInputSchema = parseJsonSchema(draft.inputSchema, "Input schema");
        const inputProperties = rawInputSchema.properties as Record<
          string,
          unknown
        >;
        const mappings = parseObject(draft.queryMappings, "Query mappings");
        if (
          Object.keys(mappings).length > 20 ||
          Object.entries(mappings).some(
            ([queryName, propertyName]) =>
              !/^[A-Za-z0-9_.~-]{1,80}$/.test(queryName) ||
              typeof propertyName !== "string" ||
              !Object.hasOwn(inputProperties, propertyName),
          )
        ) {
          throw new Error(
            "Map up to 20 valid API query names to top-level input properties.",
          );
        }
        rawQueryMappings = mappings as Record<string, string>;
      } else {
        const generated = schemaFromParameters(draft.parameters);
        parameters = draft.parameters.map((parameter) => ({
          name: parameter.name.trim(),
          type: parameter.type,
          required: parameter.required,
          ...(parameter.description.trim()
            ? { description: parameter.description.trim() }
            : {}),
          queryParameter:
            parameter.queryParameter.trim() || parameter.name.trim(),
        }));
        if (Object.keys(generated.queryMappings).length > 20)
          throw new Error("The backend supports up to 20 parameters.");
      }
      const outputSchema = draft.rawOutputSchema
        ? parseJsonSchema(draft.outputSchema, "Output schema", true)
        : undefined;
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
      if (draft.authMode === "unresolved")
        throw new Error(
          "Choose No Authentication or select a header and enter a replacement credential. The saved header is not returned by the backend.",
        );
      if (draft.authMode !== "none") {
        if (draft.authSecret.length < 8 || draft.authSecret.length > 2000)
          throw new Error("Credentials must contain 8 to 2,000 characters.");
        if (/[\u0000-\u001f\u007f]/.test(draft.authSecret))
          throw new Error("Credential values cannot contain control characters.");
        if (draft.authPrefix.length > 30 || /[\r\n]/.test(draft.authPrefix))
          throw new Error(
            "Authentication prefix must be at most 30 characters and cannot contain a line break.",
          );
      }
      const payload: CustomToolPayload = {
        name: draft.name,
        displayName: draft.displayName.trim(),
        description: draft.description.trim(),
        endpoint,
        ...(draft.rawInputSchema
          ? {
              inputSchema: rawInputSchema,
              queryMappings: rawQueryMappings,
            }
          : { parameters }),
        ...(outputSchema ? { outputSchema } : {}),
        ...(draft.authMode !== "none"
          ? {
              auth: {
                headerName: draft.authMode as
                  | "Authorization"
                  | "X-API-Key",
                ...(draft.authPrefix ? { prefix: draft.authPrefix } : {}),
                secret: draft.authSecret,
              },
            }
          : {}),
        timeoutMs,
        maxResponseBytes,
      };
      if (panel?.kind === "create") {
        setReviewPayload(payload);
        setCreationStep("review");
        return;
      }
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
    setTestResultToolId("");
    setActionError("");
    setPanel({ kind: "test", toolId: tool.id });
  }

  function createReviewedTool() {
    if (reviewPayload) saveTool.mutate({ payload: reviewPayload });
  }

  function archive(tool: CustomTool) {
    if (
      canManage &&
      window.confirm(
        `Delete “${tool.displayName}”? The backend will disable it and preserve its execution history.`,
      )
    ) {
      archiveTool.mutate(tool.id);
    }
  }

  async function retryOwnerQueries() {
    setPermissionOverride("");
    const accountResult = await account.refetch();
    if (accountResult.data?.role === "READ_ONLY") return;
    const result = await tools.refetch();
    const issue = ownerMessage(result.error);
    setPermissionOverride(issue ?? "");
  }

  const panelTool = detail.data ?? selectedFromList;
  const detailLoading = panel?.kind === "detail" && detail.isPending;
  const queryPermissionIssue =
    ownerMessage(account.error) ||
    ownerMessage(tools.error);

  return (
    <main className="custom-tools-page">
      <header className="custom-tools-header">
        <div>
          <div className="custom-tools-eyebrow">AGENT STUDIO</div>
          <h1>Tools</h1>
          <p>Manage independent HTTPS API integrations for the Agent Planner.</p>
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
        (!readOnly && tools.isLoading) ? (
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
      ) : account.isError || tools.isError ? (
        <div className="custom-tools-error" role="alert">
          <AlertCircle size={18} />
          <span>
            {errorMessage(account.error ?? tools.error)}
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
                <p>Create a secure read-only API tool to add external data to Agent workflows.</p>
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
                          <code className="custom-tool-endpoint">{tool.endpoint ?? "Legacy connection-based tool"}</code>
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
            {panel.kind === "create" && creationStep === "review" ? (
              <ToolReview
                payload={reviewPayload}
                error={formError}
                busy={saveTool.isPending}
                onBack={() => {
                  setCreationStep("configure");
                  setReviewPayload(null);
                }}
                onCreate={createReviewedTool}
              />
            ) : panel.kind === "create" || panel.kind === "edit" ? (
              <ToolForm
                draft={draft}
                setDraft={setDraft}
                existing={panel.kind === "edit" ? selectedFromList : undefined}
                error={formError}
                busy={saveTool.isPending}
                onSubmit={submitTool}
                onCancel={closePanel}
              />
            ) : panel.kind === "test" ? (
              <form className="custom-tool-test" onSubmit={runTest}>
                {justCreatedToolId === selectedId && (
                  <CreationSteps
                    active={
                      testResult?.success && testResultToolId === selectedId
                        ? 5
                        : 4
                    }
                  />
                )}
                <div className="custom-tool-config-test-note">
                  <Activity size={15} />
                  <span>
                    This sends a real test request to the configured endpoint.
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
                {testResult?.success &&
                  testResultToolId === selectedId &&
                  !panelTool?.enabled && (
                    <button
                      className="button primary"
                      type="button"
                      disabled={!canManage || toggleTool.isPending}
                      onClick={() =>
                        toggleTool.mutate({ id: selectedId, enabled: true })
                      }
                    >
                      {toggleTool.isPending ? "Enabling…" : "Enable tool"}
                    </button>
                  )}
              </form>
            ) : (
              <div className="custom-tool-detail">
                {justCreatedToolId === selectedId && (
                  <CreationSteps
                    active={
                      panelTool?.enabled ||
                      (testResult?.success && testResultToolId === selectedId)
                        ? 5
                        : 4
                    }
                  />
                )}
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
                      <span>Endpoint</span>
                      <code>{panelTool.endpoint ?? "Legacy profile-based endpoint"}</code>
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
                      {panelTool.enabled ? (
                        <button
                          className="button secondary"
                          type="button"
                          disabled={!canManage || toggleTool.isPending}
                          onClick={() =>
                            toggleTool.mutate({
                              id: selectedId,
                              enabled: false,
                            })
                          }
                        >
                          Disable tool
                        </button>
                      ) : (testResult?.success &&
                          testResultToolId === selectedId) ||
                        history.data?.some(
                          (row) =>
                            row.isTest &&
                            row.success &&
                            row.toolVersion === panelTool.configurationVersion,
                        ) ? (
                        <button
                          className="button primary"
                          type="button"
                          disabled={!canManage || toggleTool.isPending}
                          onClick={() =>
                            toggleTool.mutate({
                              id: selectedId,
                              enabled: true,
                            })
                          }
                        >
                          Enable tool
                        </button>
                      ) : (
                        <p className="custom-tool-muted">
                          Test this tool successfully before enabling it.
                        </p>
                      )}
                      <button
                        className="button danger"
                        type="button"
                        disabled={!canManage || archiveTool.isPending}
                        onClick={() => archive(panelTool)}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                    <section className="custom-tool-history">
                      <div className="custom-tool-history-heading">
                        <div>
                          <h3>Execution history</h3>
                          <p>
                            Sanitized tool arguments are shown. HTTP response
                            bodies are never stored.
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
                                  <th>Arguments</th>
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
                                    <td>
                                      {row.arguments ? (
                                        <details className="custom-history-arguments">
                                          <summary>View</summary>
                                          <pre>{JSON.stringify(row.arguments, null, 2)}</pre>
                                        </details>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
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
  existing,
  error,
  busy,
  onSubmit,
  onCancel,
}: {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  existing?: CustomTool;
  error: string;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const edit = !!existing;
  function update<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function updateParameters(value: SchemaParameter[]) {
    if (
      existing &&
      draft.rawInputSchema &&
      !window.confirm(
        "Switching to visual parameters replaces advanced input schema rules. Continue?",
      )
    )
      return;
    update("parameters", value);
    update("rawInputSchema", false);
  }
  function setRawInput(raw: boolean) {
    if (
      !raw &&
      existing &&
      draft.rawInputSchema &&
      !window.confirm(
        "Switching to visual parameters replaces advanced input schema rules. Continue?",
      )
    )
      return;
    if (raw) {
      let schema = emptySchema;
      let mappings = "{}";
      try {
        const generated = schemaFromParameters(draft.parameters);
        schema = pretty(generated.schema);
        mappings = pretty(generated.queryMappings);
      } catch {
        // Keep a valid schema draft until the visual parameters validate.
      }
      update("inputSchema", schema);
      update("queryMappings", mappings);
    }
    update("rawInputSchema", raw);
  }
  function setRawOutput(raw: boolean) {
    if (
      !raw &&
      existing &&
      draft.rawOutputSchema &&
      !window.confirm(
        "Remove the custom output schema and use the backend default open output schema?",
      )
    )
      return;
    update("rawOutputSchema", raw);
  }
  return (
    <form className="custom-tool-form" onSubmit={onSubmit}>
      {!edit && <CreationSteps active={1} />}
      <p className="custom-tool-form-intro">
        Create a secure, read-only HTTPS integration. New tools start disabled.
      </p>
      <div className="custom-tool-form-section">
        <h3>Tool details</h3>
        <label>
          Tool name
          <input
            required
            maxLength={100}
            value={draft.displayName}
            onChange={(event) => {
              const displayName = event.target.value;
              setDraft((current) => ({
                ...current,
                displayName,
                name: current.slugCustomized
                  ? current.name
                  : slugFromDisplayName(displayName),
              }));
            }}
            placeholder="Get weather"
          />
        </label>
        <label>
          Immutable tool slug
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                name: event.target.value,
                slugCustomized: true,
              }))
            }
            placeholder="get_weather"
            disabled={edit}
          />
          <small>Suggested from the tool name. Lowercase letters, numbers, _ and -; up to 64 characters.</small>
        </label>
        <label>
          AI-facing description
          <textarea
            required
            maxLength={500}
            rows={3}
            value={draft.description}
            onChange={(event) => update("description", event.target.value)}
            placeholder="Get current weather information for a specified city."
          />
          <small>Explain when the Agent should call this tool, for example: “Use this when the user asks for the current weather in a city.”</small>
        </label>
        <label>
          Full HTTPS API endpoint
          <input
            required
            maxLength={2000}
            type="url"
            value={draft.endpoint}
            onChange={(event) => update("endpoint", event.target.value)}
            placeholder="https://api.example.com/weather"
          />
          <small>GET only. Do not include query parameters; add them in the parameter mappings below. The backend checks DNS and public-address safety.</small>
        </label>
      </div>
      {edit && !existing.endpoint && (
        <p className="custom-tool-auth-warning">
          This is a legacy profile-based tool. To edit it in the new flow, enter a full HTTPS endpoint.
        </p>
      )}
      <SchemaParameterEditor
        title="Parameters"
        help="The backend generates the input schema and query mapping from these fields."
        value={draft.parameters}
        onChange={updateParameters}
        disabled={draft.rawInputSchema}
      />
      <div className="custom-tool-form-section">
        <h3>Authentication <span className="custom-tool-optional">Optional</span></h3>
        {existing?.authSecretConfigured && (
          <p className="custom-tool-auth-warning">
            <LockKeyhole size={14} />
            A credential is saved, but the API does not return its header type. Choose No Authentication to remove it, or select a header and enter a replacement credential.
          </p>
        )}
        <label>
          Authentication method
          <select
            required
            value={draft.authMode === "unresolved" ? "" : draft.authMode}
            onChange={(event) => {
              const authMode = event.target.value as AuthMode;
              setDraft((current) => ({
                ...current,
                authMode,
                authPrefix: authMode === "Authorization" ? "Bearer " : "",
                authSecret: authMode === "none" ? "" : current.authSecret,
              }));
            }}
          >
            {draft.authMode === "unresolved" && (
              <option value="" disabled>Choose how to handle saved authentication</option>
            )}
            <option value="none">No Authentication</option>
            <option value="Authorization">Authorization Header</option>
            <option value="X-API-Key">X-API-Key</option>
          </select>
        </label>
        {(draft.authMode === "Authorization" || draft.authMode === "X-API-Key") && (
          <div className="custom-tool-auth-fields">
            {draft.authMode === "Authorization" && (
              <label>
                Header prefix
                <input value={draft.authPrefix} maxLength={30} onChange={(event) => update("authPrefix", event.target.value)} placeholder="Bearer " />
              </label>
            )}
            <label className="custom-tool-secret-field">
              {existing?.authSecretConfigured ? "Replacement credential" : "Credential"}
              <input type="password" required minLength={8} maxLength={2000} autoComplete="new-password" value={draft.authSecret} onChange={(event) => update("authSecret", event.target.value)} placeholder="Enter credential" />
              <small>Sent to the backend and encrypted there. Never shown or stored in browser storage.</small>
            </label>
          </div>
        )}
      </div>
      <details className="custom-tool-advanced">
        <summary>Advanced settings</summary>
        <div className="custom-tool-advanced-content">
          <div className="custom-tool-form-section">
            <h3>Raw schemas</h3>
            <p className="custom-tool-muted">The input schema supports the backend’s restricted JSON Schema keywords. Output schema is optional; leaving it unset allows any bounded JSON object.</p>
            <label className="custom-tool-checkbox">
              <input type="checkbox" checked={draft.rawInputSchema} onChange={(event) => setRawInput(event.target.checked)} />
              <span>Edit raw input schema and query mappings</span>
            </label>
            {draft.rawInputSchema && (
              <>
                <JsonEditor id="input-schema" label="Input JSON Schema" value={draft.inputSchema} onChange={(value) => update("inputSchema", value)} />
                <label>
                  Query mappings
                  <textarea className="custom-tool-code-editor compact" rows={4} spellCheck={false} value={draft.queryMappings} onChange={(event) => update("queryMappings", event.target.value)} />
                  <small>Map API query parameter names to top-level input properties.</small>
                </label>
              </>
            )}
            <label className="custom-tool-checkbox">
              <input type="checkbox" checked={draft.rawOutputSchema} onChange={(event) => setRawOutput(event.target.checked)} />
              <span>Set an explicit output schema</span>
            </label>
            {draft.rawOutputSchema && (
              <JsonEditor id="output-schema" label="Output JSON Schema" value={draft.outputSchema} onChange={(value) => update("outputSchema", value)} />
            )}
          </div>
          <div className="custom-tool-form-section">
            <h3>Request limits</h3>
            <div className="custom-tool-number-grid">
              <label>Timeout (ms)<input required type="number" step="1" min="500" max="30000" value={draft.timeoutMs} onChange={(event) => update("timeoutMs", event.target.value)} /></label>
              <label>Maximum response (bytes)<input required type="number" step="1" min="256" max="1000000" value={draft.maxResponseBytes} onChange={(event) => update("maxResponseBytes", event.target.value)} /></label>
            </div>
          </div>
        </div>
      </details>
      {error && <p className="custom-tool-form-error" role="alert"><AlertCircle size={14} />{error}</p>}
      <div className="custom-tool-form-footer">
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={15} /> Saving…</> : edit ? <><Check size={15} /> Save changes</> : <>Review configuration <ArrowRight size={15} /></>}</button>
      </div>
    </form>
  );
}

function SchemaParameterEditor({
  title,
  help,
  value,
  onChange,
  disabled = false,
}: {
  title: string;
  help: string;
  value: SchemaParameter[];
  onChange: (value: SchemaParameter[]) => void;
  disabled?: boolean;
}) {
  const add = () => onChange([...value, {
    id: crypto.randomUUID(), name: "", type: "string", required: true, description: "", queryParameter: "",
  }]);
  return (
    <section className="custom-tool-form-section custom-tool-parameters">
      <div className="custom-tool-parameter-heading"><div><h3>{title}</h3><small>{help}</small></div><button className="button secondary" type="button" onClick={add} disabled={disabled || value.length >= 20}><Plus size={14} /> Add parameter</button></div>
      <p className="custom-tool-muted">Up to 20 parameters. Query name defaults to the parameter name.</p>
      {disabled && <p className="custom-tool-muted">Advanced input schema is active. Switch back to visual parameters in Advanced Settings to edit these fields.</p>}
      {value.length === 0 ? <div className="custom-tool-parameters-empty">No parameters. Add fields if the API expects query values.</div> : value.map((parameter, index) => (
        <div className="custom-tool-parameter-row" key={parameter.id}>
          <label>Name<input value={parameter.name} disabled={disabled} maxLength={64} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row))} placeholder="city" /></label>
          <label>Data type<select value={parameter.type} disabled={disabled} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, type: event.target.value as SchemaParameter["type"] } : row))}><option value="string">String</option><option value="number">Number</option><option value="integer">Integer</option><option value="boolean">Boolean</option></select></label>
          <label>Description<input value={parameter.description} disabled={disabled} maxLength={300} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} placeholder="City name" /></label>
          <label>API query parameter<input value={parameter.queryParameter} disabled={disabled} maxLength={80} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, queryParameter: event.target.value } : row))} placeholder={parameter.name || "city"} /></label>
          <label className="custom-tool-checkbox"><input type="checkbox" disabled={disabled} checked={parameter.required} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, required: event.target.checked } : row))} /><span>Required</span></label>
          <button className="custom-tool-remove-parameter" type="button" disabled={disabled} aria-label={`Remove ${parameter.name || "unnamed"} parameter`} onClick={() => onChange(value.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={15} /></button>
        </div>
      ))}
    </section>
  );
}

function CreationSteps({ active }: { active: number }) {
  return (
    <ol className="custom-tool-creation-steps" aria-label="Tool creation steps">
      {["Configure", "Review", "Create", "Test", "Enable"].map(
        (step, index) => (
          <li
            className={
              index + 1 === active ? "active" : index + 1 < active ? "done" : ""
            }
            key={step}
          >
            <span>{index + 1 < active ? <Check size={12} /> : index + 1}</span>
            {step}
          </li>
        ),
      )}
    </ol>
  );
}

function ToolReview({
  payload,
  error,
  busy,
  onBack,
  onCreate,
}: {
  payload: CustomToolPayload | null;
  error: string;
  busy: boolean;
  onBack: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="custom-tool-review">
      <CreationSteps active={2} />
      <h3>Review your tool</h3>
      <p>Review the endpoint and inputs. The tool will be created disabled.</p>
      {payload && (
        <dl>
          <dt>Display name</dt>
          <dd>{payload.displayName ?? payload.name}</dd>
          <dt>AI description</dt>
          <dd>{payload.description}</dd>
          <dt>Slug</dt>
          <dd>
            <code>{payload.name}</code>
          </dd>
          <dt>Endpoint</dt>
          <dd>
            {payload.endpoint}
          </dd>
          <dt>Input fields</dt>
          <dd>
            {
              payload.parameters?.length ??
              Object.keys(
                (payload.inputSchema?.properties as
                  | Record<string, unknown>
                  | undefined) ?? {},
              ).length
            }
          </dd>
          <dt>Output fields</dt>
          <dd>
            {
              payload.outputSchema
                ? Object.keys(
                    (payload.outputSchema.properties as
                      | Record<string, unknown>
                      | undefined) ?? {},
                  ).length
                : "Backend default · open JSON object"
            }
          </dd>
          <dt>Credential</dt>
          <dd>{payload.auth ? "Encrypted by backend" : "None"}</dd>
        </dl>
      )}
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
          onClick={onBack}
          disabled={busy}
        >
          Back to configure
        </button>
        <button
          type="button"
          className="button primary"
          onClick={onCreate}
          disabled={busy || !payload}
        >
          {busy ? (
            <>
              <LoaderCircle className="spin" size={15} /> Creating…
            </>
          ) : (
            <>
              <Check size={15} /> Create disabled tool
            </>
          )}
        </button>
      </div>
    </div>
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
        Uses the backend’s restricted schema keywords. References, patterns,
        combinators, and executable keywords are rejected; open output accepts
        only the backend’s empty-object default.
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
        <code>{`{ "type": "object", "properties": {}, "required": [], "additionalProperties": ${id === "output-schema" ? "true" : "false"} }`}</code>
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
