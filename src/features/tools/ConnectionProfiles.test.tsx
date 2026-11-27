import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api/client";
import { ConnectionProfiles } from "./ConnectionProfiles";
import { Integrations } from "./Integrations";

const { apiMocks, authState } = vi.hoisted(() => ({
  apiMocks: {
    customToolConnections: vi.fn(),
    customToolCredentialEncryptionStatus: vi.fn(),
    availableUserConnections: vi.fn(),
    createCustomToolConnection: vi.fn(),
    updateCustomToolConnection: vi.fn(),
    deleteCustomToolConnection: vi.fn(),
    customToolConnectionCredentials: vi.fn(),
    loginCustomToolConnection: vi.fn(),
    connectAtomic: vi.fn(),
    userConnectionStatus: vi.fn(),
    disconnectCustomToolConnection: vi.fn(),
  },
  authState: { value: null as unknown },
}));
vi.mock("../../lib/api/client", () => ({
  api: apiMocks,
  ApiError: class ApiError extends Error {
    constructor(message: string, readonly status?: number, readonly code?: string) { super(message); }
  },
}));
vi.mock("../../lib/auth/AuthProvider", () => ({ useAuth: () => authState.value }));

const profile = {
  id: "atomic_main",
  displayName: "Atomic",
  baseUrl: "https://atomic.example.com/",
  allowLocalHttp: false,
  host: "atomic.example.com",
  trustedInternal: false,
  authStrategy: "ATOMIC_COOKIE_REFRESH",
  enabled: true,
  authenticationCapabilities: { atomicPerUserLogin: true, oauth2Refresh: false },
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const disconnected = { connected: false, authStatus: "DISCONNECTED", tokenExpiresAt: null, lastRefreshedAt: null };
const connected = { connected: true, authStatus: "ACTIVE", tokenExpiresAt: null, lastRefreshedAt: null };
function auth(userId = "user-1") {
  return { session: { identity: { userId, tenantId: "tenant-1" } } };
}
function renderFeature(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}>{element}</QueryClientProvider>), client };
}
async function openConnect() {
  const button = await screen.findByRole("button", { name: "Connect" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  return screen.findByRole("dialog", { name: "Connect Atomic" });
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.value = auth();
  apiMocks.customToolConnections.mockResolvedValue([]);
  apiMocks.customToolCredentialEncryptionStatus.mockResolvedValue({ available: true });
  apiMocks.availableUserConnections.mockResolvedValue([]);
  apiMocks.customToolConnectionCredentials.mockResolvedValue([]);
  apiMocks.createCustomToolConnection.mockResolvedValue(profile);
  apiMocks.userConnectionStatus.mockResolvedValue(disconnected);
  apiMocks.connectAtomic.mockResolvedValue(connected);
  apiMocks.disconnectCustomToolConnection.mockResolvedValue(disconnected);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("connection profile and Atomic integration flows", () => {
  it("warns the admin when backend credential encryption is unavailable", async () => {
    apiMocks.customToolCredentialEncryptionStatus.mockResolvedValue({ available: false });
    renderFeature(<ConnectionProfiles />);
    expect(await screen.findByRole("alert")).toHaveTextContent("LLM_CREDENTIALS_ENCRYPTION_KEY");
  });
  it("creates an owner profile with its server configuration", async () => {
    renderFeature(<ConnectionProfiles />);
    const add = await screen.findByRole("button", { name: "Add Profile" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    fireEvent.change(await screen.findByLabelText(/Profile ID/), { target: { value: "atomic_main" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Atomic" } });
    fireEvent.change(screen.getByLabelText(/Base URL/), { target: { value: "http://localhost:3000" } });
    fireEvent.click(screen.getByLabelText(/Allow local HTTP loopback/));
    fireEvent.change(screen.getByLabelText(/Authentication strategy/), { target: { value: "ATOMIC_COOKIE_REFRESH" } });
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
    await waitFor(() => expect(apiMocks.createCustomToolConnection).toHaveBeenCalledWith({
      id: "atomic_main",
      displayName: "Atomic",
      baseUrl: "http://localhost:3000",
      allowLocalHttp: true,
      authStrategy: "ATOMIC_COOKIE_REFRESH",
    }));
  });

  it("hides profile configuration controls when an ordinary user lacks owner access", async () => {
    apiMocks.customToolConnections.mockRejectedValue(new ApiError("Owner required", 403, "INSTALLATION_OWNER_REQUIRED"));
    renderFeature(<ConnectionProfiles />);
    expect(await screen.findByRole("heading", { name: "Profile management unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Profile" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Base URL/)).not.toBeInTheDocument();
  });

  it("shows the refreshed connection state after a successful Atomic login and clears the password field", async () => {
    apiMocks.availableUserConnections.mockResolvedValue([profile]);
    apiMocks.userConnectionStatus.mockResolvedValueOnce(disconnected).mockResolvedValueOnce(connected);
    const view = renderFeature(<Integrations />);
    const dialog = await openConnect();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "temporary-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Connect$/ }));
    expect(password.value).toBe("");
    await waitFor(() => expect(apiMocks.connectAtomic).toHaveBeenCalledWith("atomic_main", "user@example.com", "temporary-password"));
    await screen.findByRole("status");
    await waitFor(() => expect(apiMocks.userConnectionStatus).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(view.client.getQueryData(["user-connection-status", "user-1", "atomic_main"])).toMatchObject({ connected: true });
  });

  it("shows friendly invalid-credential feedback and clears the password", async () => {
    apiMocks.availableUserConnections.mockResolvedValue([profile]);
    apiMocks.connectAtomic.mockRejectedValue(new ApiError("Login failed", 401, "ATOMIC_CREDENTIALS_INVALID"));
    renderFeature(<Integrations />);
    const dialog = await openConnect();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "bad-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Connect$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect");
    expect(password.value).toBe("");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("marks an expired session as Reconnect Required", async () => {
    apiMocks.availableUserConnections.mockResolvedValue([profile]);
    apiMocks.userConnectionStatus.mockResolvedValue({
      ...connected,
      tokenExpiresAt: "2000-01-01T00:00:00.000Z",
    });
    renderFeature(<Integrations />);
    expect(await screen.findByText("Reconnect Required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
  });

  it("disconnects and refreshes the status before showing Not Connected", async () => {
    apiMocks.availableUserConnections.mockResolvedValue([profile]);
    apiMocks.userConnectionStatus.mockResolvedValueOnce(connected).mockResolvedValueOnce(disconnected);
    renderFeature(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(apiMocks.disconnectCustomToolConnection).toHaveBeenCalledWith("atomic_main"));
    expect(await screen.findByText("Not Connected")).toBeInTheDocument();
  });

  it("shows only enabled personal integrations to ordinary users", async () => {
    apiMocks.availableUserConnections.mockResolvedValue([]);
    renderFeature(<Integrations />);
    expect(await screen.findByRole("heading", { name: "No personal integrations available" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
  });

  it("reloads connection status under the next signed-in user cache key", async () => {
    apiMocks.availableUserConnections.mockResolvedValue([profile]);
    const view = renderFeature(<Integrations />);
    await waitFor(() => expect(apiMocks.userConnectionStatus).toHaveBeenCalledWith("atomic_main", expect.anything()));
    authState.value = auth("user-2");
    view.rerender(<QueryClientProvider client={view.client}><Integrations /></QueryClientProvider>);
    await waitFor(() => expect(apiMocks.userConnectionStatus.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(view.client.getQueryData(["user-connection-status", "user-1", "atomic_main"])).toBeDefined();
    expect(view.client.getQueryData(["user-connection-status", "user-2", "atomic_main"])).toBeDefined();
  });
});
