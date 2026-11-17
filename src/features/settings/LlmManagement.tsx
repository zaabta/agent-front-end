import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  Coins,
  BrainCircuit,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  MessageSquareText,
  X,
} from "lucide-react";
import { api, ApiError } from "../../lib/api/client";
import { useAuth } from "../../lib/auth/AuthProvider";
import type { z } from "zod";
import { llmUsageLogSchema } from "../../lib/api/schemas";

type UsageLog = z.infer<typeof llmUsageLogSchema>;
type LlmRole = "planner" | "answer";
const providerLabels: Record<string, string> = {
  ollama: "Ollama",
  google: "Google Gemini",
  openai: "OpenAI GPT",
  openrouter: "OpenRouter",
};
const i18n = new Intl.NumberFormat(undefined);
function modelIconProvider(modelId: string) {
  const id = modelId.toLowerCase();
  return id.startsWith("qwen") ? "qwen" : id.includes("lfm") ? "liquid" : "";
}

function istanbulDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}-${parts.find((part) => part.type === "day")!.value}`;
}
function dateRange(filter: string, fromDate: string, toDate: string) {
  const today = istanbulDate();
  const start = new Date(
    `${filter === "custom" ? fromDate : today}T00:00:00+03:00`,
  );
  const end =
    filter === "custom"
      ? new Date(`${toDate}T00:00:00+03:00`)
      : filter === "yesterday"
        ? new Date(`${today}T00:00:00+03:00`)
        : new Date();
  if (filter === "yesterday") start.setUTCDate(start.getUTCDate() - 1);
  if (filter === "7d") start.setUTCDate(start.getUTCDate() - 6);
  if (filter === "30d") start.setUTCDate(start.getUTCDate() - 29);
  if (filter === "custom") end.setUTCDate(end.getUTCDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}
function total(values: (number | null | undefined)[]) {
  const known = values.filter(
    (value): value is number => typeof value === "number",
  );
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}
function formatTokens(value: number | null | undefined) {
  return value == null ? "Unavailable" : i18n.format(value);
}
function errorText(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : "The API is unavailable. Try again.";
}
function ownerPermissionMessage(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  const status =
    "status" in error && typeof error.status === "number"
      ? error.status
      : undefined;
  if (code === "INSTALLATION_OWNER_NOT_CONFIGURED" || status === 503)
    return "Provider management is unavailable until the backend configures INSTALLATION_OWNER_USER_ID.";
  if (code === "INSTALLATION_OWNER_REQUIRED" || status === 403)
    return "Only the configured installation owner can manage providers and models.";
  return "";
}

export function LlmManagement() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("7d");
  const [fromDate, setFromDate] = useState(
    istanbulDate(new Date(Date.now() - 6 * 86400000)),
  );
  const [toDate, setToDate] = useState(istanbulDate());
  const [chartGroup, setChartGroup] = useState<"date" | "week" | "month">(
    "date",
  );
  const [providerFilter, setProviderFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [logStatus, setLogStatus] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [page, setPage] = useState(0);
  const [roleChoices, setRoleChoices] = useState<
    Partial<Record<LlmRole, { provider: string; modelId: string }>>
  >({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [managementIssue, setManagementIssue] = useState("");
  const range = useMemo(
    () => dateRange(filter, fromDate, toDate),
    [filter, fromDate, toDate],
  );
  const providers = useQuery({
    queryKey: ["llm-providers"],
    queryFn: ({ signal }) => api.llmProviders(signal),
    enabled: !!auth.session,
    retry: 0,
  });
  const models = useQuery({
    queryKey: ["llm-models"],
    queryFn: ({ signal }) => api.llmModels(signal),
    enabled: !!auth.session,
    retry: 0,
  });
  const roleConfigurations = useQuery({
    queryKey: ["llm-role-configurations"],
    queryFn: ({ signal }) => api.llmRoleConfigurations(signal),
    enabled: !!auth.session,
    retry: 0,
  });
  const summary = useQuery({
    queryKey: ["llm-usage-summary", range],
    queryFn: ({ signal }) => api.llmUsageSummary(range.from, range.to, signal),
    enabled: !!auth.session,
    retry: 0,
  });
  const daily = useQuery({
    queryKey: ["llm-usage-daily", range, chartGroup],
    queryFn: ({ signal }) =>
      api.llmUsageDaily(range.from, range.to, chartGroup, signal),
    enabled: !!auth.session,
    retry: 0,
  });
  const byModel = useQuery({
    queryKey: ["llm-usage-model", range],
    queryFn: ({ signal }) => api.llmUsageByModel(range.from, range.to, signal),
    enabled: !!auth.session,
    retry: 0,
  });
  const logs = useQuery({
    queryKey: ["llm-usage-logs", range, page],
    queryFn: ({ signal }) =>
      api.llmUsageLogs(range.from, range.to, 25, page * 25, signal),
    enabled: !!auth.session,
    retry: 0,
  });
  const handleAdminError = (failure: unknown) => {
    const message = ownerPermissionMessage(failure);
    if (message) {
      setManagementIssue(message);
      setError("");
    } else setError(errorText(failure));
  };
  const retryAdmin = async () => {
    const results = await Promise.all([
      providers.refetch(),
      models.refetch(),
      roleConfigurations.refetch(),
    ]);
    const denied = results.find(
      (result) => result.isError && ownerPermissionMessage(result.error),
    );
    setManagementIssue(denied ? ownerPermissionMessage(denied.error) : "");
  };
  const canManage =
    providers.isSuccess &&
    models.isSuccess &&
    roleConfigurations.isSuccess &&
    !managementIssue;
  const updateRoleConfiguration = useMutation({
    mutationFn: (input: {
      role: LlmRole;
      provider: string;
      modelId: string;
    }) =>
      api.setLlmRoleConfiguration(input.role, input.provider, input.modelId),
    onSuccess: async (_result, variables) => {
      setManagementIssue("");
      setRoleChoices((current) => ({ ...current, [variables.role]: undefined }));
      setNotice(
        `${variables.role === "planner" ? "Planning / Routing / Thinking" : "Answer Generation"} configuration saved.`,
      );
      setError("");
      await qc.invalidateQueries({ queryKey: ["llm-role-configurations"] });
    },
    onError: handleAdminError,
  });
  const providerRows = providers.data ?? [];
  const modelRows = models.data ?? [];
  const selectableModels = modelRows.filter(
    (model) =>
      model.enabled &&
      model.available &&
      model.compatible &&
      (model.provider === "ollama" ||
        providerRows.some(
          (provider) => provider.id === model.provider && provider.configured,
        )),
  );
  const allUsage = (summary.data?.data ?? []).filter(
    (row) => !providerFilter || row.provider === providerFilter,
  );
  const modelUsage = (byModel.data?.data ?? []).filter(
    (row) =>
      (!providerFilter || row.provider === providerFilter) &&
      (!modelFilter || row.modelId === modelFilter),
  );
  const scopedUsage = modelFilter ? modelUsage : allUsage;
  const totalInput = total(scopedUsage.map((row) => row.inputTokens));
  const totalOutput = total(scopedUsage.map((row) => row.outputTokens));
  const totalTokens = total(scopedUsage.map((row) => row.totalTokens));
  const invocationCount = scopedUsage.reduce(
    (sum, row) => sum + row.invocations,
    0,
  );
  const missingCount = scopedUsage.reduce(
    (sum, row) => sum + (row.missingUsageCount ?? 0),
    0,
  );
  const rawChartRows = daily.data?.data ?? [];
  const hasProviderTrend = rawChartRows.some((row) => row.provider);
  const hasModelTrend = rawChartRows.some((row) => row.modelId);
  const hasDetailedTrend =
    (!providerFilter || hasProviderTrend) && (!modelFilter || hasModelTrend);
  const chartRows = rawChartRows.filter(
    (row) =>
      (!providerFilter ||
        !hasProviderTrend ||
        row.provider === providerFilter) &&
      (!modelFilter || !hasModelTrend || row.modelId === modelFilter),
  );
  const maxChart = Math.max(1, ...chartRows.map((row) => row.totalTokens ?? 0));
  const maxProvider = Math.max(
    1,
    ...allUsage.map((row) => row.totalTokens ?? 0),
  );
  const maxModel = Math.max(
    1,
    ...modelUsage.map((row) => row.totalTokens ?? 0),
  );
  const logRows = (logs.data?.data ?? []).filter(
    (row) =>
      (!providerFilter || row.provider === providerFilter) &&
      (!modelFilter || row.modelId === modelFilter) &&
      (!logStatus || row.status === logStatus) &&
      (!logSearch ||
        `${row.modelId} ${row.provider} ${row.status} ${row.errorCategory ?? ""}`
          .toLowerCase()
          .includes(logSearch.toLowerCase())),
  );
  const usageProviders = [
    ...new Set(
      (summary.data?.data ?? [])
        .map((row) => row.provider)
        .filter((value): value is string => !!value),
    ),
  ];
  const usageModels = [
    ...new Set(
      (byModel.data?.data ?? [])
        .filter((row) => !providerFilter || row.provider === providerFilter)
        .map((row) => row.modelId)
        .filter((value): value is string => !!value),
    ),
  ];
  const logStatuses = [
    ...new Set((logs.data?.data ?? []).map((row) => row.status)),
  ];
  const setFilterValue = (value: string) => {
    setFilter(value);
    setPage(0);
  };
  function roleChoice(role: LlmRole) {
    const current = roleConfigurations.data?.[role];
    const choice = roleChoices[role];
    return {
      current,
      provider: choice?.provider ?? current?.provider ?? "",
      modelId: choice?.modelId ?? current?.modelId ?? "",
    };
  }
  function updateRoleChoice(
    role: LlmRole,
    value: { provider: string; modelId: string },
  ) {
    setRoleChoices((current) => ({ ...current, [role]: value }));
    updateRoleConfiguration.reset();
  }
  function roleConfigurationCard(
    role: LlmRole,
    title: string,
    description: string,
  ) {
    const selection = roleChoice(role);
    const candidates = selectableModels.filter(
      (model) => model.provider === selection.provider,
    );
    const configuredProviders = providerRows.filter(
      (provider) => provider.configured,
    );
    const providerListed = configuredProviders.some(
      (provider) => provider.id === selection.provider,
    );
    const modelListed = candidates.some(
      (model) => model.modelId === selection.modelId,
    );
    const unchanged =
      selection.current?.source === "role" &&
      selection.current.provider === selection.provider &&
      selection.current.modelId === selection.modelId;
    const busy =
      updateRoleConfiguration.isPending &&
      updateRoleConfiguration.variables?.role === role;
    const saved =
      updateRoleConfiguration.isSuccess &&
      updateRoleConfiguration.variables?.role === role;
    const failed =
      updateRoleConfiguration.isError &&
      updateRoleConfiguration.variables?.role === role;
    const providerOptions = [
      ...(!providerListed && selection.provider
        ? [
            {
              value: selection.provider,
              label: `${providerLabels[selection.provider] ?? selection.provider} · not configured`,
              provider: selection.provider,
              disabled: true,
              current: true,
            },
          ]
        : []),
      ...configuredProviders.map((provider) => ({
        value: provider.id,
        label: providerLabels[provider.id] ?? provider.id,
        provider: provider.id,
        current: selection.current?.provider === provider.id,
      })),
    ];
    const modelOptions = candidates.map((model) => ({
      value: model.modelId,
      label: model.displayName || model.modelId,
      detail: model.displayName ? model.modelId : undefined,
      provider: model.provider,
      icon: modelIconProvider(model.modelId) || undefined,
      current:
        selection.current?.provider === model.provider &&
        selection.current.modelId === model.modelId,
    }));
    return (
      <section className="llm-role-config-card" key={role}>
        <div className="llm-role-config-heading">
          <span className={`llm-role-icon ${role}`}>
            {role === "planner" ? (
              <BrainCircuit size={20} />
            ) : (
              <MessageSquareText size={20} />
            )}
          </span>
          <div>
            <h4>{title}</h4>
            <p>{description}</p>
          </div>
          <span className="llm-role-source">
            {selection.current?.source === "role"
              ? "Role configuration"
              : "Shared configuration"}
          </span>
        </div>
        <p className="llm-role-current">
          <ProviderIcon provider={selection.current?.provider ?? ""} size={18} />
          <span>
            <small>Current model</small>
            {selection.current ? (
              <b className="llm-current-model-name">
                <span>
                  {providerLabels[selection.current.provider] ??
                    selection.current.provider}{" · "}
                </span>
                {modelIconProvider(selection.current.modelId) && (
                  <ProviderIcon
                    provider={modelIconProvider(selection.current.modelId)}
                    size={13}
                  />
                )}
                <span>{selection.current.modelId}</span>
              </b>
            ) : (
              <b>Unavailable</b>
            )}
          </span>
          <span className="llm-role-source-current">
            {selection.current?.provider === "ollama"
              ? "Local"
              : selection.current?.source ?? "Unavailable"}
          </span>
        </p>
        <div className="llm-role-selectors">
          <label>
            Provider
            <IconSelect
              label={`${title} provider`}
              value={selection.provider}
              disabled={!canManage || configuredProviders.length === 0}
              options={providerOptions}
              onChange={(provider) => {
                const modelId =
                  selectableModels.find((model) => model.provider === provider)
                    ?.modelId ?? "";
                updateRoleChoice(role, { provider, modelId });
              }}
            />
          </label>
          <label>
            Model
            <IconSelect
              label={`${title} model`}
              value={selection.modelId}
              disabled={!canManage || candidates.length === 0}
              options={modelOptions}
              emptyLabel="No compatible models"
              onChange={(modelId) =>
                updateRoleChoice(role, {
                  provider: selection.provider,
                  modelId,
                })
              }
            />
          </label>
        </div>
        {failed && (
          <p className="llm-role-feedback error" role="alert">
            {errorText(updateRoleConfiguration.error)}
          </p>
        )}
        {saved && (
          <p className="llm-role-feedback success" role="status">
            Configuration saved and refreshed.
          </p>
        )}
        <button
          type="button"
          className="button primary llm-role-save"
          disabled={
            !canManage ||
            !selection.provider ||
            !selection.modelId ||
            !modelListed ||
            unchanged ||
            updateRoleConfiguration.isPending
          }
          onClick={() =>
            updateRoleConfiguration.mutate({
              role,
              provider: selection.provider,
              modelId: selection.modelId,
            })
          }
        >
          {busy ? (
            <>
              <LoaderCircle className="spin" size={14} /> Saving…
            </>
          ) : (
            "Save configuration"
          )}
        </button>
      </section>
    );
  }
  return (
    <div className="llm-management">
      <section id="providers" className="panel setting-panel llm-admin-panel">
        <div className="panel-heading">
          <div>
            <h3>AI providers</h3>
            <p>
              Configure model roles for Planning and Answer Generation, and
              select the models used for planning and answers.
            </p>
          </div>
        </div>
        {!auth.session ? (
          <p className="llm-permission">
            <ShieldCheck size={16} /> Sign in to view provider and model
            settings.
          </p>
        ) : providers.isLoading ||
          models.isLoading ||
          roleConfigurations.isLoading ? (
          <p className="loading-results">
            <LoaderCircle className="spin" size={16} /> Loading provider
            configuration…
          </p>
        ) : providers.isError ||
          models.isError ||
          roleConfigurations.isError ||
          managementIssue ? (
          <div className="inline-error" role="alert">
            <X size={15} />
            <span>
              {managementIssue ||
                ownerPermissionMessage(
                  providers.error ?? models.error ?? roleConfigurations.error,
                ) ||
                errorText(
                  providers.error ?? models.error ?? roleConfigurations.error,
                )}
            </span>
            <button type="button" onClick={() => void retryAdmin()}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="llm-config-heading">
              <div>
                <h3>Model roles</h3>
                <p>
                  Configure Planning and Answer Generation separately. Changes
                  apply to new requests.
                </p>
              </div>
            </div>
            <div className="llm-role-config-grid">
              {roleConfigurationCard(
                "planner",
                "Planning / Routing / Thinking",
                "Select the model that plans and routes Agent work.",
              )}
              {roleConfigurationCard(
                "answer",
                "Answer Generation",
                "Select the model that writes answers for users.",
              )}
            </div>
          </>
        )}
        {notice && (
          <p className="llm-notice" role="status">
            <Check size={14} />
            {notice}
          </p>
        )}
        {error && (
          <div className="inline-error" role="alert">
            <X size={15} />
            <span>{error}</span>
            <button type="button" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
      </section>

      <section id="usage" className="panel setting-panel llm-usage-panel">
        <div className="panel-heading">
          <div>
            <h3>Token usage</h3>
            <p>
              Historical usage stays with the exact provider and model that
              handled each request · Europe/Istanbul
            </p>
          </div>
          <button
            className="button secondary llm-action"
            type="button"
            onClick={() => {
              void summary.refetch();
              void daily.refetch();
              void byModel.refetch();
              void logs.refetch();
            }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <div className="llm-filters" role="group" aria-label="Usage filters">
          <div
            className="llm-date-filters"
            role="group"
            aria-label="Usage date range"
          >
            {[
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["7d", "Last 7 days"],
              ["30d", "Last 30 days"],
              ["custom", "Custom"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={filter === value ? "selected" : ""}
                aria-pressed={filter === value}
                onClick={() => setFilterValue(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {filter === "custom" && (
            <>
              <label>
                From{" "}
                <input
                  type="date"
                  required
                  value={fromDate}
                  max={toDate}
                  onChange={(event) => {
                    if (event.target.value) {
                      setFromDate(event.target.value);
                      setPage(0);
                    }
                  }}
                />
              </label>
              <label>
                To{" "}
                <input
                  type="date"
                  required
                  value={toDate}
                  min={fromDate}
                  onChange={(event) => {
                    if (event.target.value) {
                      setToDate(event.target.value);
                      setPage(0);
                    }
                  }}
                />
              </label>
            </>
          )}
          <label>
            Provider{" "}
            <select
              aria-label="Filter usage by provider"
              value={providerFilter}
              onChange={(event) => {
                setProviderFilter(event.target.value);
                setModelFilter("");
                setPage(0);
              }}
            >
              <option value="">All providers</option>
              {usageProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {providerLabels[provider] ?? provider}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model{" "}
            <select
              aria-label="Filter usage by model"
              value={modelFilter}
              onChange={(event) => {
                setModelFilter(event.target.value);
                setPage(0);
              }}
            >
              <option value="">All models</option>
              {usageModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
        </div>
        {summary.isLoading ? (
          <p className="loading-results">
            <LoaderCircle className="spin" size={16} /> Loading usage…
          </p>
        ) : summary.isError ? (
          <UsageError
            error={summary.error}
            retry={() => void summary.refetch()}
          />
        ) : (
          <>
            <div className="llm-total-grid">
              <UsageMetric label="Input tokens" value={totalInput} />
              <UsageMetric label="Output tokens" value={totalOutput} />
              <UsageMetric
                label="Total tokens"
                value={totalTokens}
                detail={
                  missingCount
                    ? `${i18n.format(missingCount)} invocations missing provider usage`
                    : undefined
                }
              />
              <UsageMetric label="LLM invocations" value={invocationCount} />
            </div>
            <div className="llm-analytics-grid">
              <section className="llm-chart-card">
                <div className="llm-chart-heading">
                  <div>
                    <h4>Usage trend</h4>
                    <small>
                      {daily.data?.timezone ?? "Europe/Istanbul"}
                      {(providerFilter || modelFilter) && !hasDetailedTrend
                        ? " · some selected filters are unavailable for date totals"
                        : ""}
                    </small>
                  </div>
                  <select
                    aria-label="Chart grouping"
                    value={chartGroup}
                    onChange={(event) =>
                      setChartGroup(
                        event.target.value as "date" | "week" | "month",
                      )
                    }
                  >
                    <option value="date">Daily</option>
                    <option value="week">Weekly</option>
                    <option value="month">Monthly</option>
                  </select>
                </div>
                <div className="llm-chart-legend">
                  <span>
                    <i className="input" />
                    Input
                  </span>
                  <span>
                    <i className="output" />
                    Output
                  </span>
                </div>
                {daily.isLoading ? (
                  <p className="loading-results">Loading chart…</p>
                ) : daily.isError ? (
                  <UsageError
                    error={daily.error}
                    retry={() => void daily.refetch()}
                  />
                ) : chartRows.length ? (
                  <div
                    className="llm-bar-chart"
                    role="img"
                    aria-label={`Token usage grouped by ${chartGroup}`}
                  >
                    {chartRows.map((row) => (
                      <div className="llm-bar-row" key={row.period}>
                        <span>{row.period}</span>
                        <div
                          className="llm-bar-track"
                          aria-label={`Input ${formatTokens(row.inputTokens)}; output ${formatTokens(row.outputTokens)}`}
                        >
                          {row.inputTokens === null &&
                          row.outputTokens === null ? (
                            <span
                              className="llm-unknown-bar"
                              style={{
                                width: `${Math.max(0, ((row.totalTokens ?? 0) / maxChart) * 100)}%`,
                              }}
                            />
                          ) : (
                            <>
                              <span
                                className="llm-input-bar"
                                style={{
                                  width: `${Math.max(0, ((row.inputTokens ?? 0) / maxChart) * 100)}%`,
                                }}
                              />
                              <span
                                className="llm-output-bar"
                                style={{
                                  width: `${Math.max(0, ((row.outputTokens ?? 0) / maxChart) * 100)}%`,
                                }}
                              />
                            </>
                          )}
                        </div>
                        <b>{formatTokens(row.totalTokens)}</b>
                        <small>
                          {row.missingUsageCount
                            ? `${row.missingUsageCount} missing`
                            : `${row.invocations} calls`}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="llm-empty">
                    No invocations in this date range.
                  </p>
                )}
              </section>
              <section className="llm-chart-card">
                <div className="llm-chart-heading">
                  <div>
                    <h4>Usage by provider</h4>
                    <small>Actual reported token totals</small>
                  </div>
                </div>
                {allUsage.length ? (
                  <div className="llm-breakdown llm-chart-breakdown">
                    {allUsage.map((row) => (
                      <div key={row.provider ?? "unknown"}>
                        <span>
                          {providerLabels[row.provider ?? ""] ??
                            row.provider ??
                            "Unknown provider"}
                        </span>
                        <b>{formatTokens(row.totalTokens)}</b>
                        <div className="llm-breakdown-track">
                          <span
                            style={{
                              width: `${Math.max(2, ((row.totalTokens ?? 0) / maxProvider) * 100)}%`,
                            }}
                          />
                        </div>
                        <small>
                          {row.invocations} calls
                          {row.missingUsageCount
                            ? ` · ${row.missingUsageCount} missing`
                            : ""}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="llm-empty">
                    No invocations in this date range.
                  </p>
                )}
              </section>
            </div>
            <section className="llm-chart-card llm-model-usage">
              <div className="llm-chart-heading">
                <div>
                  <h4>Usage by model</h4>
                  <small>Actual reported token totals</small>
                </div>
              </div>
              {byModel.isLoading ? (
                <p className="loading-results">Loading model totals…</p>
              ) : byModel.isError ? (
                <UsageError
                  error={byModel.error}
                  retry={() => void byModel.refetch()}
                />
              ) : modelUsage.length ? (
                <div className="llm-breakdown llm-model-breakdown">
                  {modelUsage.map((row) => (
                    <div key={`${row.provider}/${row.modelId}`}>
                      <span>
                        {providerLabels[row.provider ?? ""] ?? row.provider} ·{" "}
                        {row.modelId}
                      </span>
                      <b>{formatTokens(row.totalTokens)}</b>
                      <div className="llm-breakdown-track">
                        <span
                          style={{
                            width: `${Math.max(2, ((row.totalTokens ?? 0) / maxModel) * 100)}%`,
                          }}
                        />
                      </div>
                      <small>
                        {row.invocations} calls
                        {row.missingUsageCount
                          ? ` · ${row.missingUsageCount} missing`
                          : ""}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="llm-empty">No model usage in this date range.</p>
              )}
            </section>
            <section className="llm-log-section">
              <div className="llm-chart-heading">
                <div>
                  <h4>Invocation logs</h4>
                  <small>
                    {logs.data
                      ? `Showing ${logRows.length} of ${logs.data.total} records · page filters apply to loaded results`
                      : ""}
                  </small>
                </div>
                <div className="llm-pagination">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={page === 0 || logs.isFetching}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={
                      !logs.data ||
                      page * 25 + logs.data.data.length >= logs.data.total ||
                      logs.isFetching
                    }
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
              <div className="llm-log-filters">
                <label className="llm-log-search">
                  <Search size={14} />
                  <input
                    aria-label="Search invocation logs"
                    placeholder="Search model or status"
                    value={logSearch}
                    onChange={(event) => setLogSearch(event.target.value)}
                  />
                </label>
                <label>
                  Status{" "}
                  <select
                    aria-label="Filter logs by status"
                    value={logStatus}
                    onChange={(event) => setLogStatus(event.target.value)}
                  >
                    <option value="">All statuses</option>
                    {logStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {logs.isLoading ? (
                <p className="loading-results">Loading invocation logs…</p>
              ) : logs.isError ? (
                <UsageError
                  error={logs.error}
                  retry={() => void logs.refetch()}
                />
              ) : logRows.length ? (
                <InvocationLogs rows={logRows} />
              ) : (
                <p className="llm-empty">
                  No invocation records match these filters on this page.
                </p>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}

function ProviderIcon({
  provider,
  size = 16,
}: {
  provider: string;
  size?: number;
}) {
  const label = `${providerLabels[provider] ?? provider} logo`;
  if (provider === "ollama")
    return (
      <svg
        className="provider-logo ollama-logo"
        role="img"
        aria-label={label}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
      >
        <path d="M16.361 10.26a.9.9 0 0 0-.558.47l-.072.148l.001.207c0 .193.004.217.059.353c.076.193.152.312.291.448c.24.238.51.3.872.205a.86.86 0 0 0 .517-.436a.75.75 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.1 1.1 0 0 0-.466 0m-9.203.005c-.305.096-.533.32-.65.639a1.2 1.2 0 0 0-.06.52c.057.309.31.59.598.667c.362.095.632.033.872-.205c.14-.136.215-.255.291-.448c.055-.136.059-.16.059-.353l.001-.207l-.072-.148a.9.9 0 0 0-.565-.472a1 1 0 0 0-.474.007m4.184 2c-.131.071-.223.25-.195.383c.031.143.157.288.353.407c.105.063.112.072.117.136c.004.038-.01.146-.029.243c-.02.094-.036.194-.036.222c.002.074.07.195.143.253c.064.052.076.054.255.059c.164.005.198.001.264-.03c.169-.082.212-.234.15-.525c-.052-.243-.042-.28.087-.355c.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48a.4.4 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053l-.053-.032c-.219-.13-.259-.145-.391-.143a.4.4 0 0 0-.193.032m.39-2.195c-.373.036-.475.05-.654.086a4.5 4.5 0 0 0-.951.328c-.94.46-1.589 1.226-1.787 2.114c-.04.176-.045.234-.045.53c0 .294.005.357.043.524c.264 1.16 1.332 2.017 2.714 2.173c.3.033 1.596.033 1.896 0c1.11-.125 2.064-.727 2.493-1.571c.114-.226.169-.372.22-.602c.039-.167.044-.23.044-.523c0-.297-.005-.355-.045-.531c-.288-1.29-1.539-2.304-3.072-2.497a7 7 0 0 0-.855-.031zm.645.937a3.3 3.3 0 0 1 1.44.514c.223.148.537.458.671.662c.166.251.26.508.303.82c.02.143.01.251-.043.482c-.08.345-.332.705-.672.957a3 3 0 0 1-.689.348c-.382.122-.632.144-1.525.138c-.582-.006-.686-.01-.853-.042q-.856-.16-1.35-.68c-.264-.28-.385-.535-.45-.946c-.03-.192.025-.509.137-.776c.136-.326.488-.73.836-.963c.403-.269.934-.46 1.422-.512c.187-.02.586-.02.773-.002m-5.503-11a1.65 1.65 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503c0 .544.064 1.24.155 1.721c.02.107.031.202.023.208l-.187.152a5.3 5.3 0 0 0-.949 1.02a5.5 5.5 0 0 0-.94 2.339a6.6 6.6 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195l-.037.064c-.269.452-.498 1.105-.605 1.732c-.084.496-.095.629-.095 1.294c0 .67.009.803.088 1.266c.095.555.288 1.143.503 1.534c.071.128.243.393.264.407c.007.003-.014.067-.046.141a7.4 7.4 0 0 0-.548 1.873a5 5 0 0 0-.071.991c0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597c.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.9.9 0 0 0-.194-.25a1.7 1.7 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451c.124-.486.329-.918.544-1.154a.8.8 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.14 3.14 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834c.563-.814 1.353-1.336 2.237-1.475c.199-.033.57-.028.776.01c.226.04.367.028.512-.041c.179-.085.268-.19.374-.431c.093-.215.165-.333.36-.576c.234-.29.46-.489.822-.729c.413-.27.884-.467 1.352-.561c.17-.035.25-.04.569-.04s.398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602c.034.057.095.177.132.267c.105.241.195.346.374.43c.14.068.286.082.503.045c.343-.058.607-.053.943.016c1.144.23 2.14 1.173 2.581 2.437c.385 1.108.276 2.267-.296 3.153c-.097.15-.193.27-.333.419c-.301.322-.301.722-.001 1.053c.493.539.801 1.866.708 3.036c-.062.772-.26 1.463-.533 1.854a2 2 0 0 1-.224.258a.9.9 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295c.253 1.008.231 2.01-.059 2.581a1 1 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074l.036-.134c.019-.076.057-.3.088-.516a9 9 0 0 0 0-1.258c-.11-.875-.295-1.57-.597-2.226c-.032-.074-.053-.138-.046-.141a1.4 1.4 0 0 0 .108-.152c.376-.569.607-1.284.724-2.228c.031-.26.031-1.378 0-1.628c-.083-.645-.182-1.082-.348-1.525a6 6 0 0 0-.329-.7l-.038-.064l.131-.194c.402-.604.636-1.262.727-2.04a6.6 6.6 0 0 0-.024-1.358a5.5 5.5 0 0 0-.939-2.339a5.3 5.3 0 0 0-.95-1.02l-.186-.152a.7.7 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503c-.19-.924-.535-1.658-.98-2.082c-.354-.338-.716-.482-1.15-.455c-.996.059-1.8 1.205-2.116 3.01a7 7 0 0 0-.097.726c0 .036-.007.066-.015.066a1 1 0 0 1-.149-.078A4.86 4.86 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a1 1 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a7 7 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2 2 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388c.03.113.06.244.069.292c.007.047.026.152.041.233c.067.365.098.76.102 1.24l.002.475l-.12.175l-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.4 8.4 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711c.067-.05.079-.049.157.013m9.825-.012c.17.126.358.46.498.888c.28.854.36 2.028.212 3.145c-.019.14-.024.151-.057.144l-.238-.06a3.7 3.7 0 0 0-.954-.124h-.278l-.119-.178l-.119-.175l.002-.474c.004-.669.066-1.19.214-1.772c.157-.623.434-1.185.68-1.382c.078-.062.09-.063.159-.012" />
      </svg>
    );
  if (provider === "qwen")
    return (
      <svg
        className="provider-logo"
        role="img"
        aria-label="Qwen logo"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        >
          <path d="M9 2h3.5L14 4.5h5.13L20.5 7m1.5 7.5l-1.645 2.663h-2.477L15 22h-3.217M5 20l-1.5-2.5l1-3l-2.5-5L4 7" />
          <path d="m19.19 9.662l1.31-2.661H10l1-2l-2-3l-2.251 5H4l5 10H6l-1 3h5.5l1.252 2l5.65-9.935L18.94 14.5H22z" />
          <path d="M12 15.5L9 10h6z" />
        </g>
      </svg>
    );
  if (provider === "liquid")
    return (
      <svg
        className="provider-logo"
        role="img"
        aria-label="Liquid logo"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
        fillRule="evenodd"
      >
        <path d="M12.028 8.546l-.008.005 3.03 5.25a3.94 3.94 0 01.643 2.162c0 .754-.212 1.46-.58 2.062l6.173-1.991L11.63 0 9.304 3.872l2.724 4.674zM6.837 24l4.85-4.053h-.013c-2.219 0-4.017-1.784-4.017-3.984 0-.794.235-1.534.64-2.156l2.865-4.976-2.381-4.087L2 16.034 6.83 24h.007zM13.737 19.382h-.001L8.222 24h8.182l4.148-6.769-6.815 2.151z" />
      </svg>
    );
  if (provider === "openai")
    return (
      <svg
        className="provider-logo"
        role="img"
        aria-label={label}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
      >
        <path d="M22.282 9.821a6 6 0 0 0-.516-4.91a6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9a6.05 6.05 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206a6 6 0 0 0 3.997-2.9a6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354l-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023l-.141-.085l-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365l2.602-1.5l2.607 1.5v2.999l-2.597 1.5l-2.607-1.5Z" />
      </svg>
    );
  if (provider === "google")
    return (
      <svg
        className="provider-logo"
        role="img"
        aria-label={label}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
      >
        <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
      </svg>
    );
  if (provider === "openrouter")
    return (
      <svg
        className="provider-logo"
        role="img"
        aria-label={label}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
      >
        <path d="M18.654 3.87a5.087 5.087 0 1 1 0 10.174l5.046 5.046c.64.641.187 1.737-.72 1.737H8.48a8.479 8.479 0 1 1 0-16.958h10.175zM8.479 7.26a5.087 5.087 0 1 0 0 10.176 5.087 5.087 0 0 0 0-10.175z" />
      </svg>
    );
  const Icon = Activity;
  return <Icon size={size} role="img" aria-label={label} />;
}
type IconSelectOption = {
  value: string;
  label: string;
  provider: string;
  icon?: string;
  detail?: string;
  disabled?: boolean;
  current?: boolean;
};
function IconSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  emptyLabel = "Choose an option",
}: {
  label: string;
  value: string;
  options: IconSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  return (
    <div className="llm-icon-select" ref={root}>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className="llm-icon-select-trigger"
        ref={trigger}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") setOpen(true);
        }}
      >
        <span className="llm-icon-select-brand">
          {selected ? (
            <ProviderIcon provider={selected.icon ?? selected.provider} size={17} />
          ) : (
            <Activity size={17} />
          )}
        </span>
        <span className="llm-icon-select-value">
          <b>{selected?.label ?? (value || emptyLabel)}</b>
          {selected?.detail && <small>{selected.detail}</small>}
        </span>
        <ChevronDown size={16} className={open ? "is-open" : ""} />
      </button>
      {open && (
        <div className="llm-icon-select-menu" role="listbox" aria-label={label}>
          {options.length ? (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                className="llm-icon-select-option"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                <span className="llm-icon-select-brand">
                  <ProviderIcon provider={option.icon ?? option.provider} size={17} />
                </span>
                <span className="llm-icon-select-value">
                  <b>{option.label}</b>
                  {option.detail && <small>{option.detail}</small>}
                </span>
                {option.provider === "ollama" && (
                  <span className="llm-icon-select-local">Local</span>
                )}
                {option.current && (
                  <span className="llm-icon-select-current">Current</span>
                )}
                {option.value === value && <Check size={15} />}
              </button>
            ))
          ) : (
            <p className="llm-icon-select-empty">{emptyLabel}</p>
          )}
        </div>
      )}
    </div>
  );
}
function UsageMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null;
  detail?: string;
}) {
  const Icon =
    label === "Input tokens"
      ? ArrowDownToLine
      : label === "Output tokens"
        ? ArrowUpFromLine
        : label === "Total tokens"
          ? Coins
          : Activity;
  return (
    <article>
      <span>
        <Icon size={15} />
        {label}
      </span>
      <b>{formatTokens(value)}</b>
      {detail && <small>{detail}</small>}
    </article>
  );
}
function UsageError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="inline-error" role="alert">
      <X size={15} />
      <span>{errorText(error)}</span>
      <button type="button" onClick={retry}>
        Retry
      </button>
    </div>
  );
}
function InvocationLogs({ rows }: { rows: UsageLog[] }) {
  return (
    <div className="llm-table-scroll">
      <table className="llm-log-table">
        <thead>
          <tr>
            <th>Time (Istanbul)</th>
            <th>Provider / exact model</th>
            <th>Input</th>
            <th>Output</th>
            <th>Total</th>
            <th>Status</th>
            <th>Usage source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                {new Date(row.createdAt).toLocaleString(undefined, {
                  timeZone: "Europe/Istanbul",
                })}
              </td>
              <td>
                <span className="llm-log-model">
                  <ProviderIcon provider={row.provider} size={14} />
                  {providerLabels[row.provider] ?? row.provider} · {row.modelId}
                </span>
              </td>
              <td>{formatTokens(row.inputTokens)}</td>
              <td>{formatTokens(row.outputTokens)}</td>
              <td>{formatTokens(row.totalTokens)}</td>
              <td>
                <span
                  className={`llm-log-status ${row.status === "failed" ? "failed" : row.status === "success" ? "success" : "neutral"}`}
                >
                  {row.status}
                  {row.errorCategory ? ` · ${row.errorCategory}` : ""}
                </span>
              </td>
              <td>
                {row.accuracy === "unavailable" || row.totalTokens === null
                  ? "Usage unavailable"
                  : (row.usageSource ?? row.accuracy)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
