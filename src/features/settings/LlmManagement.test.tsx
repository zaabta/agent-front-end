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
    llmRoleConfigurations: vi.fn(),
    llmUsageSummary: vi.fn(),
    llmUsageDaily: vi.fn(),
    llmUsageByModel: vi.fn(),
    llmUsageLogs: vi.fn(),
    syncLlmModels: vi.fn(),
    addLlmModel: vi.fn(),
    updateLlmModel: vi.fn(),
    testLlmModel: vi.fn(),
    setLlmRoleConfiguration: vi.fn(),
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
let roleSelection = {
  planner: { provider: "ollama", modelId: "qwen3:8b", source: "shared" },
  answer: { provider: "ollama", modelId: "qwen3:8b", source: "shared" },
};
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
function chooseMenuOption(label: string, option: RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
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
  roleSelection = {
    planner: { provider: "ollama", modelId: "qwen3:8b", source: "shared" },
    answer: { provider: "ollama", modelId: "qwen3:8b", source: "shared" },
  };
  apiMocks.llmRoleConfigurations.mockImplementation(async () => roleSelection);
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
  apiMocks.setLlmRoleConfiguration.mockImplementation(
    async (role: "planner" | "answer", provider: string, modelId: string) => {
      roleSelection = {
        ...roleSelection,
        [role]: { provider, modelId, source: "role" },
      };
      return roleSelection;
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
    apiMocks.llmProviders.mockResolvedValue([
      { id: "ollama", configured: true, baseUrl: "http://127.0.0.1:11434" },
      { id: "google", configured: true },
      { id: "openrouter", configured: true },
    ]);
    renderFeature();
    expect((await screen.findAllByText("qwen3:8b")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("20").length).toBeGreaterThan(0);
    expect(screen.getByText("Input tokens")).toBeInTheDocument();
    expect(apiMocks.llmUsageDaily).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "date",
      expect.anything(),
    );
    expect(screen.getByText("2026-11-14")).toBeInTheDocument();
    expect(screen.getByText("Planning / Routing / Thinking")).toBeInTheDocument();
    expect(screen.getByText("Answer Generation")).toBeInTheDocument();
    expect(screen.getAllByText("Local")).toHaveLength(2);
    expect(
      document.querySelectorAll('.llm-role-current [aria-label="Qwen logo"]'),
    ).toHaveLength(2);
    expect(screen.queryByText("Local AI")).not.toBeInTheDocument();
    expect(screen.queryByText("Cloud AI")).not.toBeInTheDocument();
    expect(screen.queryByText("Provider connections")).not.toBeInTheDocument();
    expect(screen.queryByText("Model registry")).not.toBeInTheDocument();
    expect(screen.queryByText("Manage provider credentials and connection status.")).not.toBeInTheDocument();
    expect(screen.queryByText("Test models or change which ones are enabled")).not.toBeInTheDocument();
    expect(screen.queryByText("22 models")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Planning / Routing / Thinking provider",
      }),
    );
    const providerOptions = within(
      screen.getByRole("listbox", {
        name: "Planning / Routing / Thinking provider",
      }),
    );
    expect(
      providerOptions.getByRole("option", { name: /Google Gemini/ }),
    ).toBeInTheDocument();
    expect(
      within(providerOptions.getByRole("option", { name: /Ollama/ })).getByText("Current"),
    ).toBeInTheDocument();
    expect(
      within(providerOptions.getByRole("option", { name: /Ollama/ })).getByText("Local"),
    ).toBeInTheDocument();
    expect(
      within(providerOptions.getByRole("option", { name: /Google Gemini/ })).getByRole("img", {
        name: "Google Gemini logo",
      }),
    ).toBeInTheDocument();
    expect(
      within(providerOptions.getByRole("option", { name: /OpenRouter/ })).getByRole("img", {
        name: "OpenRouter logo",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Planning / Routing / Thinking provider",
      }),
    );
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Planning / Routing / Thinking model",
      }),
    );
    const qwenOption = within(
      screen.getByRole("listbox", {
        name: "Planning / Routing / Thinking model",
      }),
    ).getByRole("option", { name: /qwen3:8b/ });
    expect(qwenOption.querySelector(".llm-icon-select-current")).toBeInTheDocument();
    expect(within(qwenOption).getByRole("img", { name: "Qwen logo" })).toBeInTheDocument();
  });

  it("shows the Liquid icon for LFM models", async () => {
    apiMocks.llmModels.mockResolvedValue([
      model,
      {
        ...model,
        id: "model-liquid",
        provider: "openrouter",
        modelId: "lfm-2",
        displayName: "Liquid LFM 2",
        local: false,
      },
    ]);
    renderFeature();
    await screen.findByRole("combobox", {
      name: "Planning / Routing / Thinking provider",
    });
    chooseMenuOption("Planning / Routing / Thinking provider", /OpenRouter/);
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Planning / Routing / Thinking model",
      }),
    );
    expect(
      within(
        screen.getByRole("listbox", {
          name: "Planning / Routing / Thinking model",
        }),
      )
        .getByRole("option", { name: /Liquid LFM 2/ })
        .querySelector('[aria-label="Liquid logo"]'),
    ).toBeInTheDocument();
  });

  it("syncs provider models and refreshes provider status and both role choices", async () => {
    const lfmModel = {
      ...model,
      id: "model-liquid-ollama",
      modelId: "LiquidAI/lfm2.5-2.6b:latest",
      displayName: "LiquidAI LFM 2.5",
    };
    const openaiModel = {
      ...model,
      id: "model-openai",
      provider: "openai",
      modelId: "gpt-4.1-mini",
      displayName: "gpt-4.1-mini",
      local: false,
    };
    apiMocks.syncLlmModels.mockImplementation(async () => {
      apiMocks.llmProviders.mockResolvedValue([
        { id: "ollama", configured: true },
        { id: "google", configured: false },
        { id: "openrouter", configured: true },
        { id: "openai", configured: true },
      ]);
      apiMocks.llmModels.mockResolvedValue([model, lfmModel, openaiModel]);
      return [model, lfmModel, openaiModel];
    });
    renderFeature();
    await screen.findByRole("combobox", {
      name: "Planning / Routing / Thinking model",
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Models refreshed from providers.",
    );
    expect(apiMocks.syncLlmModels).toHaveBeenCalledTimes(1);
    expect(apiMocks.llmModels).toHaveBeenCalledTimes(2);
    expect(apiMocks.llmProviders).toHaveBeenCalledTimes(2);
    for (const role of [
      "Planning / Routing / Thinking",
      "Answer Generation",
    ]) {
      fireEvent.click(screen.getByRole("combobox", { name: `${role} model` }));
      expect(
        within(
          screen.getByRole("listbox", { name: `${role} model` }),
        ).getByRole("option", { name: /LiquidAI LFM 2\.5/ }),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("combobox", { name: `${role} model` }));
    }
    chooseMenuOption("Answer Generation provider", /OpenAI GPT/);
    fireEvent.click(
      screen.getByRole("combobox", { name: "Answer Generation model" }),
    );
    expect(
      within(
        screen.getByRole("listbox", { name: "Answer Generation model" }),
      ).getByRole("option", { name: /gpt-4\.1-mini/ }),
    ).toBeInTheDocument();
  });

  it("filters historical usage by yesterday, provider, and exact model", async () => {
    renderFeature();
    expect(
      await screen.findByRole("combobox", {
        name: "Planning / Routing / Thinking provider",
      }),
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
    expect(apiMocks.llmRoleConfigurations).toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Sync models" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("API key for OpenAI GPT"),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(apiMocks.llmUsageSummary).toHaveBeenCalled());
    expect(screen.getAllByText("20").length).toBeGreaterThan(0);
  });

  it("does not gate model controls by the tenant role when the API allows access", async () => {
    authState.value = baseAuth("TENANT_ADMIN");
    const openai = {
      ...model,
      id: "model-openai",
      provider: "openai",
      modelId: "gpt-test",
      displayName: "GPT test",
      local: false,
    };
    apiMocks.llmProviders.mockResolvedValue([
      { id: "ollama", configured: true },
      { id: "openai", configured: true },
    ]);
    apiMocks.llmModels.mockResolvedValue([model, openai]);
    renderFeature();
    const selector = await screen.findByRole("combobox", {
      name: "Planning / Routing / Thinking provider",
    });
    expect(selector).toBeEnabled();
    chooseMenuOption("Planning / Routing / Thinking provider", /OpenAI GPT/);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Save configuration" })[0],
    );
    await waitFor(() =>
      expect(apiMocks.setLlmRoleConfiguration).toHaveBeenCalledWith(
        "planner",
        "openai",
        "gpt-test",
      ),
    );
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

  it("saves planner configuration independently and refreshes its source", async () => {
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
    await screen.findByRole("combobox", {
      name: "Planning / Routing / Thinking provider",
    });
    chooseMenuOption("Planning / Routing / Thinking provider", /Google Gemini/);
    chooseMenuOption("Planning / Routing / Thinking model", /Gemini test/);
    const historicalCalls = apiMocks.llmUsageSummary.mock.calls.length;
    fireEvent.click(
      screen.getAllByRole("button", { name: "Save configuration" })[0],
    );
    await waitFor(() =>
      expect(apiMocks.setLlmRoleConfiguration).toHaveBeenCalledWith(
        "planner",
        "google",
        "gemini-test",
      ),
    );
    expect(await screen.findByText("Configuration saved and refreshed.")).toBeInTheDocument();
    expect(screen.getAllByText("role").length).toBeGreaterThan(0);
    expect(screen.getByText("Answer Generation")).toBeInTheDocument();
    expect(screen.getAllByText("Local").length).toBeGreaterThan(0);
    expect(apiMocks.llmRoleConfigurations).toHaveBeenCalledTimes(2);
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

  it("does not render provider credential controls", async () => {
    renderFeature();
    await screen.findByRole("combobox", {
      name: "Planning / Routing / Thinking provider",
    });
    expect(screen.queryByLabelText(/API key for/)).not.toBeInTheDocument();
    expect(screen.queryByText("Provider connections")).not.toBeInTheDocument();
  });
});
