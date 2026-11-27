import { useRef, useState, type FormEvent } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, RefreshCw, ShieldCheck, Unplug, X } from "lucide-react";
import {
  ApiError,
  api,
  type AvailableUserConnection,
  type UserConnectionStatus,
} from "../../lib/api/client";
import { useAuth } from "../../lib/auth/AuthProvider";
import "./CustomTools.css";

function message(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "ATOMIC_CREDENTIALS_INVALID") return "Email or password is incorrect. Check your details and try again.";
    if (error.code === "HTTPS_REQUIRED") return "HTTPS is required except for explicitly approved local development connections.";
    if (error.status === 403) return "You do not have permission to connect this integration.";
    if (error.status === 429) return "Too many connection attempts. Wait a moment before trying again.";
    if (error.status === 503 || (error.status != null && error.status >= 500)) return "Atomic is temporarily unavailable. Try again later.";
    if (error.status === 401) return "Your SitePilot session expired. Sign in again and retry.";
  }
  if (error instanceof TypeError || (error instanceof ApiError && !error.status))
    return "Could not reach the service. Check your connection and try again.";
  return error instanceof Error ? error.message : "The request failed. Try again.";
}

const statusKey = (userId: string | undefined, profileId: string) => [
  "user-connection-status",
  userId,
  profileId,
] as const;

function connectionState(status: UserConnectionStatus) {
  if (status.authStatus === "DISCONNECTED") return "Not Connected";
  if (
    !status.connected ||
    (status.tokenExpiresAt != null && Date.parse(status.tokenExpiresAt) <= Date.now())
  ) return "Reconnect Required";
  return "Connected";
}

export function Integrations() {
  const auth = useAuth();
  const qc = useQueryClient();
  const userId = auth.session?.identity.userId;
  const [connectProfile, setConnectProfile] = useState<AvailableUserConnection | null>(null);
  const [busyProfile, setBusyProfile] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const profiles = useQuery({
    queryKey: ["available-user-integrations"],
    queryFn: ({ signal }) => api.availableUserConnections(signal),
    enabled: !!auth.session,
    retry: false,
  });
  const available = (profiles.data ?? []).filter(
    (profile) => profile.authenticationCapabilities.atomicPerUserLogin,
  );
  const statuses = useQueries({
    queries: available.map((profile) => ({
      queryKey: statusKey(userId, profile.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.userConnectionStatus(profile.id, signal),
      enabled: !!userId && profiles.isSuccess,
      retry: false,
    })),
  });

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connectProfile) return;
    const emailInput = event.currentTarget.elements.namedItem("email") as HTMLInputElement;
    const email = emailInput.value;
    let password = passwordRef.current?.value ?? "";
    event.currentTarget.reset();
    setError("");
    setNotice("");
    setBusyProfile(connectProfile.id);
    try {
      await api.connectAtomic(connectProfile.id, email, password);
      password = "";
      const key = statusKey(userId, connectProfile.id);
      await qc.invalidateQueries({ queryKey: key });
      const refreshed = qc.getQueryData<UserConnectionStatus>(key);
      if (!refreshed?.connected) throw new Error("Atomic did not confirm the connection. Please retry.");
      setConnectProfile(null);
      setNotice(`${connectProfile.displayName ?? connectProfile.id} connected.`);
    } catch (e) {
      setError(message(e));
    } finally {
      if (passwordRef.current) passwordRef.current.value = "";
      setBusyProfile("");
    }
  }

  async function disconnect(profile: AvailableUserConnection) {
    setError("");
    setNotice("");
    setBusyProfile(profile.id);
    try {
      await api.disconnectCustomToolConnection(profile.id);
      const key = statusKey(userId, profile.id);
      await qc.invalidateQueries({ queryKey: key });
      const refreshed = qc.getQueryData<UserConnectionStatus>(key);
      if (refreshed?.authStatus !== "DISCONNECTED")
        throw new Error("Atomic did not confirm the disconnection. Please retry.");
      setNotice(`${profile.displayName ?? profile.id} disconnected.`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusyProfile("");
    }
  }

  function closeConnect() {
    if (passwordRef.current) passwordRef.current.value = "";
    setConnectProfile(null);
    setError("");
  }

  return <main className="custom-tools-page integrations-page">
    <header className="custom-tools-header"><div><div className="custom-tools-eyebrow">WORKSPACE</div><h1>Integrations</h1><p>Connect your account to services approved for personal use.</p></div></header>
    {!auth.session ? <p className="custom-tools-message">Sign in to view integrations.</p>
      : profiles.isPending ? <p className="custom-tools-message"><LoaderCircle className="spin" size={16} /> Loading integrations…</p>
        : profiles.isError ? <div className="custom-tools-permission" role="alert"><ShieldCheck size={20} /><div><h2>Integrations are unavailable</h2><p>{message(profiles.error)}</p></div><button className="button secondary" onClick={() => void profiles.refetch()}><RefreshCw size={14} /> Retry</button></div>
          : <>
            {error && !connectProfile && <div className="custom-tools-error" role="alert">{error}</div>}
            {notice && <p className="custom-tools-notice" role="status">{notice}</p>}
            {available.length === 0 ? <div className="custom-tools-empty"><h2>No personal integrations available</h2><p>No enabled profiles currently advertise approved Atomic per-user login.</p></div>
              : <section className="custom-tool-list" aria-label="Available integrations">{available.map((profile, index) => {
                const query = statuses[index];
                const status = query?.data;
                const state = status ? connectionState(status) : "Not Connected";
                const isConnected = state === "Connected";
                const canManageConnection = status && status.authStatus !== "DISCONNECTED";
                return <article className="custom-tool-card" key={profile.id}>
                  <div className="custom-tool-main"><div className="custom-tool-title-row"><h3>{profile.displayName ?? profile.id}</h3><span className={`connection-profile-status ${isConnected ? "is-enabled" : "is-disabled"}`}><i />{query?.isPending ? "Checking…" : query?.isError ? "Status unavailable" : state}</span></div>
                    {query?.isError && <p role="alert">{message(query.error)} <button className="integrations-inline-button" onClick={() => void query.refetch()}>Retry status</button></p>}
                    {status?.tokenExpiresAt && <p>Session expires {new Date(status.tokenExpiresAt).toLocaleString()}.</p>}
                    <div className="integrations-card-actions">
                      {!isConnected && <button className="button primary" disabled={busyProfile === profile.id || query?.isPending || query?.isError} onClick={() => { setError(""); setConnectProfile(profile); }}>{state === "Reconnect Required" ? "Reconnect" : "Connect"}</button>}
                      {canManageConnection && <button className="button secondary" disabled={busyProfile === profile.id} onClick={() => void disconnect(profile)}><Unplug size={14} />{busyProfile === profile.id ? "Disconnecting…" : "Disconnect"}</button>}
                      {busyProfile === profile.id && <LoaderCircle className="spin" size={16} aria-label="Connection request in progress" />}
                    </div>
                  </div>
                </article>;
              })}</section>}
          </>}
    {connectProfile && <div className="integration-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConnect(); }}>
      <section className="integration-modal" role="dialog" aria-modal="true" aria-labelledby="integration-connect-title">
        <header><div><span>SECURE CONNECTION</span><h2 id="integration-connect-title">Connect {connectProfile.displayName ?? connectProfile.id}</h2><p>Sign in with your Atomic account.</p></div><button type="button" aria-label="Close" onClick={closeConnect}><X size={18} /></button></header>
        <form onSubmit={(event) => void connect(event)}>
          <label>Email<input required type="email" name="email" maxLength={120} autoComplete="username" autoFocus /></label>
          <label>Password<input ref={passwordRef} required type="password" name="password" minLength={8} maxLength={1024} autoComplete="current-password" /></label>
          {error && <p className="integration-modal-error" role="alert">{error}</p>}
          <footer><button className="button secondary" type="button" onClick={closeConnect}>Cancel</button><button className="button primary" disabled={busyProfile === connectProfile.id}>{busyProfile === connectProfile.id ? "Connecting…" : "Connect"}</button></footer>
        </form>
      </section>
    </div>}
  </main>;
}
