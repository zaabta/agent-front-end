import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmManagement } from "./LlmManagement";

const { apiMocks, authState } = vi.hoisted(() => ({
  apiMocks: {
    llmProviders: vi.fn(),
    llmModels: vi.fn(),
    activeLlmModel: vi.fn(),
    llmUsageSummary: vi.fn(),
    llmUsageDaily: vi.fn(),
    llmUsageByModel: vi.fn(),
    llmUsageLogs: vi.fn(),
    syncLlmModels: vi.fn(),
    addLlmModel: vi.fn(),
    updateLlmModel: vi.fn(),
    testLlmModel: vi.fn(),
    setActiveLlmModel: vi.fn(),
    saveLlmCredential: vi.fn(),
    revokeLlmCredential: vi.fn(),
    testLlmProvider: vi.fn(),
  },
  authState: { value: null as unknown },
}));
vi.mock("../../lib/api/client", () => ({
  api: apiMocks,
  ApiError: class ApiError extends Error {},
}));
vi.mock("../../lib/auth/AuthProvider", () => ({
  useAuth: () => authState.value,
}));

const usage = {
  timezone: "Europe/Istanbul",
  from: "2026-11-07T00:00:00.000Z",
  to: "2026-11-14T00:00:00.000Z",
  groupBy: "provider",
  data: [
    {
      period: "ollama",
      provider: "ollama",
      modelId: null,
      invocations: 2,
      inputTokens: 0,
      outputTokens: 20,
      totalTokens: 20,
      missingUsageCount: 0,
    },
  ],
};
const model = {
  id: "model-1",
  provider: "ollama",
  modelId: "qwen3:8b",
  displayName: "qwen3:8b",
  compatible: true,
  enabled: true,
  source: "ollama",
  available: true,
  local: true,
  validationStatus: "available",
};
let activeSelection = { provider: "ollama", modelId: "qwen3:8b" };
const baseAuth = (role: string) => ({
  session: { identity: { role, tenantId: "tenant-1", userId: "user-1" } },
});
function renderFeature() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LlmManagement />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.value = baseAuth("SUPER_ADMIN");
  apiMocks.llmProviders.mockResolvedValue([
    { id: "ollama", configured: true, baseUrl: "http://127.0.0.1:11434" },
    { id: "google", configured: false },
    { id: "openrouter", configured: true },
  ]);
  apiMocks.llmModels.mockResolvedValue([model]);
  activeSelection = { provider: "ollama", modelId: "qwen3:8b" };
  apiMocks.activeLlmModel.mockImplementation(async () => activeSelection);
  apiMocks.llmUsageSummary.mockResolvedValue(usage);
  apiMocks.llmUsageDaily.mockResolvedValue({
    ...usage,
    groupBy: "date",
    data: [{ ...usage.data[0], period: "2026-11-14" }],
  });
  apiMocks.llmUsageByModel.mockResolvedValue({
    ...usage,
    groupBy: "model",
    data: [
      { ...usage.data[0], period: "ollama/qwen3:8b", modelId: "qwen3:8b" },
    ],
  });
  apiMocks.llmUsageLogs.mockResolvedValue({
    data: [],
    total: 0,
    limit: 25,
    offset: 0,
  });
  apiMocks.syncLlmModels.mockResolvedValue([model]);
  apiMocks.addLlmModel.mockResolvedValue({});
  apiMocks.updateLlmModel.mockResolvedValue({});
  apiMocks.testLlmModel.mockResolvedValue({
    id: "model-1",
    provider: "ollama",
    modelId: "qwen3:8b",
    available: true,
    validationStatus: "available",
  });
  apiMocks.setActiveLlmModel.mockImplementation(
    async (provider: string, modelId: string) => {
      activeSelection = { provider, modelId };
      return activeSelection;
    },
  );
  apiMocks.saveLlmCredential.mockResolvedValue({
    provider: "openai",
    configured: true,
    source: "database",
  });
  apiMocks.revokeLlmCredential.mockResolvedValue({
    provider: "openai",
    configured: false,
    source: "none",
  });
  apiMocks.testLlmProvider.mockResolvedValue({
    provider: "openai",
    configured: true,
    reachable: true,
    authenticated: true,
    statusCode: 200,
  });
});
afterEach(() => cleanup());

describe("LLM settings", () => {
  it("shows backend models and usage values while keeping provider secrets out of the UI", async () => {
    renderFeature();
    expect((await screen.findAllByText("qwen3:8b")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Add a key to connect").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("OpenAI GPT").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("img", { name: "OpenAI GPT logo" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("img", { name: "Google Gemini logo" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("20").length).toBeGreaterThan(0);
    expect(screen.getByText("Input tokens")).toBeInTheDocument();
    expect(apiMocks.llmUsageDaily).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "date",
      expect.anything(),
    );
    expect(
      screen
        .getAllByRole("button", { name: "Save key" })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    expect(screen.getByText("2026-11-14")).toBeInTheDocument();
    expect(screen.getAllByText("Ollama · qwen3:8b").length).toBeGreaterThan(0);
  });

  it("shows model test results beside the model controls", async () => {
    renderFeature();
    fireEvent.click(await screen.findByRole("button", { name: "Test model" }));
    expect(await screen.findAllByRole("status")).toHaveLength(2);
    expect(screen.getAllByText("qwen3:8b: available.")).toHaveLength(2);
  });

  it("filters historical usage by yesterday, provider, and exact model", async () => {
    renderFeature();
    expect(
      await screen.findByRole("combobox", { name: "Choose a model" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    await waitFor(() =>
      expect(apiMocks.llmUsageSummary).toHaveBeenCalledTimes(2),
    );
    const [from, to] = apiMocks.llmUsageSummary.mock.calls.at(-1) as [
      string,
      string,
      unknown,
    ];
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Filter usage by provider" }),
      { target: { value: "ollama" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Filter usage by model" }),
      { target: { value: "qwen3:8b" } },
    );
    expect(
      screen.getByRole("combobox", { name: "Filter usage by model" }),
    ).toHaveValue("qwen3:8b");
    expect(
      screen.getByText(/some selected filters are unavailable for date totals/),
    ).toBeInTheDocument();
    expect(screen.getByText("Input tokens")).toBeInTheDocument();
  });

  it("hides provider controls when the backend rejects a non-owner with 403", async () => {
    authState.value = baseAuth("TENANT_ADMIN");
    apiMocks.llmProviders.mockRejectedValue(
      Object.assign(new Error("forbidden"), {
        status: 403,
        code: "INSTALLATION_OWNER_REQUIRED",
      }),
    );
    renderFeature();
    expect(
      await screen.findByText(/Only the configured installation owner/),
    ).toBeInTheDocument();
    expect(apiMocks.llmProviders).toHaveBeenCalled();
    expect(apiMocks.llmModels).toHaveBeenCalled();
    expect(apiMocks.activeLlmModel).toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Sync models" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("API key for OpenAI GPT"),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(apiMocks.llmUsageSummary).toHaveBeenCalled());
    expect(screen.getAllByText("20").length).toBeGreaterThan(0);
  });

  it("keeps configuration mutations disabled for non-super-admins", async () => {
    authState.value = baseAuth("TENANT_ADMIN");
    apiMocks.llmProviders.mockResolvedValue([
      { id: "ollama", configured: true },
      { id: "openai", configured: true },
    ]);
    renderFeature();
    const selector = await screen.findByRole("combobox", {
      name: "Choose a model",
    });
    expect(selector).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Sync models" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("API key for OpenAI GPT")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Use this model" }),
    ).toBeDisabled();
    expect(apiMocks.setActiveLlmModel).not.toHaveBeenCalled();
  });

  it("explains that provider management needs INSTALLATION_OWNER_USER_ID after a 503", async () => {
    apiMocks.llmProviders.mockRejectedValue(
      Object.assign(new Error("unconfigured"), {
        status: 503,
        code: "INSTALLATION_OWNER_NOT_CONFIGURED",
      }),
    );
    renderFeature();
    expect(
      await screen.findByText(/backend configures INSTALLATION_OWNER_USER_ID/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sync models" }),
    ).not.toBeInTheDocument();
  });

  it("keeps missing usage distinct from zero", async () => {
    apiMocks.llmUsageSummary.mockResolvedValue({
      ...usage,
      data: [
        {
          ...usage.data[0],
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          missingUsageCount: 1,
        },
      ],
    });
    renderFeature();
    await screen.findByText(/invocations missing provider usage/);
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText(/missing provider usage/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(apiMocks.llmUsageSummary).toHaveBeenCalled());
  });

  it("switches the active model and refreshes the displayed selection", async () => {
    const gemini = {
      ...model,
      id: "model-gemini",
      provider: "google",
      modelId: "gemini-test",
      displayName: "Gemini test",
      local: false,
    };
    apiMocks.llmProviders.mockResolvedValue([
      { id: "ollama", configured: true },
      { id: "google", configured: true },
    ]);
    apiMocks.llmModels.mockResolvedValue([model, gemini]);
    renderFeature();
    const selector = await screen.findByRole("combobox", {
      name: "Choose a model",
    });
    fireEvent.change(selector, { target: { value: "model-gemini" } });
    expect(screen.getAllByText("Gemini test").length).toBeGreaterThan(0);
    const historicalCalls = apiMocks.llmUsageSummary.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Use this model" }));
    await waitFor(() =>
      expect(apiMocks.setActiveLlmModel).toHaveBeenCalledWith(
        "google",
        "gemini-test",
      ),
    );
    expect(
      await screen.findByText("Google Gemini · gemini-test"),
    ).toBeInTheDocument();
    expect(apiMocks.llmUsageSummary).toHaveBeenCalledTimes(historicalCalls);
  });

  it("shows provider errors and lets administrators retry unavailable configuration", async () => {
    apiMocks.llmProviders.mockRejectedValue(
      new Error("Provider API unavailable"),
    );
    renderFeature();
    expect(
      await screen.findByText("Provider API unavailable"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(apiMocks.llmProviders).toHaveBeenCalledTimes(2));
  });

  it("saves and revokes credentials without retaining or logging the secret", async () => {
    apiMocks.llmProviders.mockResolvedValue([
      { id: "ollama", configured: true },
      { id: "openai", configured: true },
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderFeature();
    const secret = "secure-test-key-not-for-storage";
    const input = await screen.findByLabelText("API key for OpenAI GPT");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.click(
      within(input.closest("article")!).getByRole("button", {
        name: "Show API key",
      }),
    );
    expect(input).toHaveAttribute("type", "text");
    fireEvent.click(
      within(input.closest("article")!).getByRole("button", {
        name: "Hide API key",
      }),
    );
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: secret } });
    fireEvent.click(
      within(input.closest("article")!).getByRole("button", {
        name: "Replace key",
      }),
    );
    await waitFor(() =>
      expect(apiMocks.saveLlmCredential).toHaveBeenCalledWith("openai", secret),
    );
    await waitFor(() => expect(input).toHaveValue(""));
    fireEvent.click(
      [...input.closest("article")!.querySelectorAll("button")].find(
        (button) => button.textContent === "Test",
      )!,
    );
    await waitFor(() =>
      expect(apiMocks.testLlmProvider).toHaveBeenCalledWith("openai"),
    );
    fireEvent.click(
      [...input.closest("article")!.querySelectorAll("button")].find(
        (button) => button.textContent === "Revoke",
      )!,
    );
    await waitFor(() =>
      expect(apiMocks.revokeLlmCredential).toHaveBeenCalledWith("openai"),
    );
    expect(confirm).toHaveBeenCalled();
    expect(localStorage.getItem("apiKey")).toBeNull();
    expect(sessionStorage.getItem("apiKey")).toBeNull();
    expect(
      Object.keys(localStorage)
        .map((key) => localStorage.getItem(key))
        .join(" "),
    ).not.toContain(secret);
    expect(
      Object.keys(sessionStorage)
        .map((key) => sessionStorage.getItem(key))
        .join(" "),
    ).not.toContain(secret);
    expect(
      [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]
        .flat()
        .join(" "),
    ).not.toContain(secret);
    confirm.mockRestore();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});
