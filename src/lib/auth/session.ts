export type TenantRole =
  "SUPER_ADMIN" | "TENANT_ADMIN" | "MEMBER" | "READ_ONLY";
export interface AuthResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: { id: string; username?: string; displayName?: string | null };
}
export interface SessionIdentity {
  id: string;
  label: string;
  email?: string;
  tenantId: string;
  userId: string;
  groupId: string;
  role?: TenantRole;
}
const ACCOUNT_EMAIL_SESSION_KEY = "sitepilot:accountEmail";
export interface MemorySession {
  accessToken: string;
  expiresAt: number;
  identity: SessionIdentity;
}
let current: MemorySession | null = null;
const subscribers = new Set<(value: MemorySession | null) => void>();
function publish() {
  subscribers.forEach((listener) => listener(current));
}
export const session = {
  getState: () => current,
  getAccessToken: () => {
    if (current && Date.now() >= current.expiresAt) {
      current = null;
      publish();
    }
    return current?.accessToken ?? null;
  },
  setAuth: (auth: AuthResponse, email?: string) => {
    const normalizedEmail = email?.trim();
    if (email !== undefined) {
      if (normalizedEmail?.includes("@"))
        sessionStorage.setItem(ACCOUNT_EMAIL_SESSION_KEY, normalizedEmail);
      else sessionStorage.removeItem(ACCOUNT_EMAIL_SESSION_KEY);
    }
    const accountEmail =
      (email === undefined ? undefined : normalizedEmail) ||
      sessionStorage.getItem(ACCOUNT_EMAIL_SESSION_KEY) ||
      undefined;
    current = {
      accessToken: auth.accessToken,
      expiresAt: Date.now() + auth.expiresIn * 1000,
      identity: {
        id: auth.user.id,
        label:
          auth.user.displayName ||
          accountEmail ||
          auth.user.username ||
          auth.user.id,
        ...(accountEmail ? { email: accountEmail } : {}),
        tenantId: "",
        userId: auth.user.id,
        groupId: "",
      },
    };
    publish();
  },
  setSession: (value: MemorySession) => {
    current = value;
    publish();
  },
  setAccessToken: (token: string | null) => {
    if (!token) {
      current = null;
      publish();
      return;
    }
    current = {
      accessToken: token,
      expiresAt: Date.now() + 60_000,
      identity: {
        id: "test",
        label: "Test",
        tenantId: "",
        userId: "",
        groupId: "",
      },
    };
    publish();
  },
  subscribe: (listener: (value: MemorySession | null) => void) => {
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  },
  clear: () => {
    current = null;
    sessionStorage.removeItem(ACCOUNT_EMAIL_SESSION_KEY);
    publish();
  },
};
