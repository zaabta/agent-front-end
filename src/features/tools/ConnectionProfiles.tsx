import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, ApiError, type CustomToolConnection } from "../../lib/api/client";
import { useAuth } from "../../lib/auth/AuthProvider";
import "./CustomTools.css";

type Draft = {
  id: string;
  displayName: string;
  baseUrl: string;
  allowLocalHttp: boolean;
  authStrategy: "NONE" | "SHARED" | "ATOMIC_COOKIE_REFRESH" | "OAUTH2_REFRESH";
  tokenUrl: string;
  clientId: string;
  enabled: boolean;
};
const empty: Draft = {
  id: "",
  displayName: "",
  baseUrl: "",
  allowLocalHttp: false,
  authStrategy: "NONE",
  tokenUrl: "",
  clientId: "",
  enabled: true,
};
function issue(error: unknown) {
  if (error instanceof ApiError && error.code === "INSTALLATION_OWNER_REQUIRED")
    return "Only the configured installation owner can manage connection profiles.";
  if (error instanceof ApiError && error.code === "INSTALLATION_OWNER_NOT_CONFIGURED")
    return "The backend has not configured INSTALLATION_OWNER_USER_ID.";
  return error instanceof Error ? error.message : "The API request failed.";
}

export function ConnectionProfiles() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(empty);
  const [editing, setEditing] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [credentialsProfile, setCredentialsProfile] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credentialError, setCredentialError] = useState("");
  const profiles = useQuery({
    queryKey: ["custom-tool-profiles"],
    queryFn: ({ signal }) => api.customToolConnections(signal),
    enabled: !!auth.session,
    retry: false,
  });
  const encryptionStatus = useQuery({
    queryKey: ["custom-tool-credential-encryption-status"],
    queryFn: ({ signal }) => api.customToolCredentialEncryptionStatus(signal),
    enabled: !!auth.session,
    retry: false,
  });
  const selectedProfile = profiles.data?.find((profile) => profile.id === credentialsProfile);
  const credentials = useQuery({
    queryKey: ["custom-tool-credentials", credentialsProfile],
    queryFn: ({ signal }) => api.customToolConnectionCredentials(credentialsProfile, signal),
    enabled: !!credentialsProfile && !!selectedProfile,
    retry: false,
  });
  const save = useMutation({
    mutationFn: () => editing
      ? api.updateCustomToolConnection(editing, {
          displayName: draft.displayName,
          baseUrl: draft.baseUrl,
          allowLocalHttp: draft.allowLocalHttp,
          authStrategy: draft.authStrategy,
          ...(draft.tokenUrl ? { tokenUrl: draft.tokenUrl } : {}),
          ...(draft.clientId ? { clientId: draft.clientId } : {}),
          enabled: draft.enabled,
        })
      : api.createCustomToolConnection({
          id: draft.id,
          displayName: draft.displayName,
          baseUrl: draft.baseUrl,
          allowLocalHttp: draft.allowLocalHttp,
          authStrategy: draft.authStrategy,
          ...(draft.tokenUrl ? { tokenUrl: draft.tokenUrl } : {}),
          ...(draft.clientId ? { clientId: draft.clientId } : {}),
        }),
    onSuccess: async () => {
      setError("");
      setNotice(editing ? "Connection profile updated." : "Connection profile created.");
      setDraft(empty);
      setEditing("");
      setFormOpen(false);
      await qc.invalidateQueries({ queryKey: ["custom-tool-profiles"] });
    },
    onError: (e) => setError(issue(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCustomToolConnection(id),
    onSuccess: async () => {
      setNotice("Connection profile deleted.");
      setCredentialsProfile("");
      await qc.invalidateQueries({ queryKey: ["custom-tool-profiles"] });
    },
    onError: (e) => setError(issue(e)),
  });

  function editProfile(profile: CustomToolConnection) {
    setEditing(profile.id);
    setFormOpen(true);
    setDraft({
      id: profile.id,
      displayName: profile.displayName ?? profile.id,
      baseUrl: profile.baseUrl ?? "",
      allowLocalHttp: profile.allowLocalHttp ?? false,
      authStrategy: profile.authStrategy ?? "NONE",
      tokenUrl: profile.tokenUrl ?? "",
      clientId: profile.clientId ?? "",
      enabled: profile.enabled ?? true,
    });
    setError("");
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    save.mutate();
  }
  async function addSharedCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    let password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "");
    const email = String(data.get("email") ?? "");
    data.delete("password");
    form.reset();
    setCredentialError("");
    setCredentialBusy(true);
    try {
      await api.loginCustomToolConnection(credentialsProfile, name, email, password);
      password = "";
      setNotice("Shared connection saved.");
      await qc.invalidateQueries({ queryKey: ["custom-tool-credentials", credentialsProfile] });
    } catch (e) {
      password = "";
      setCredentialError(issue(e));
    } finally {
      password = "";
      setCredentialBusy(false);
    }
  }

  return (
    <main className="custom-tools-page connection-profiles-page">
      <header className="custom-tools-header">
        <div>
          <div className="custom-tools-eyebrow">AGENT STUDIO</div>
          <h1>Connection Profiles</h1>
          <p>Manage approved hosts and authentication capabilities for custom tools.</p>
        </div>
        {profiles.isSuccess && <button className="button primary custom-tools-add" type="button" onClick={() => { setEditing(""); setDraft(empty); setFormOpen(true); }}>
          <Plus size={16} /> Add Profile
        </button>}
      </header>
      {!auth.session ? <p className="custom-tools-message">Sign in to manage connection profiles.</p>
        : profiles.isPending ? <p className="custom-tools-message"><LoaderCircle className="spin" size={16} /> Loading profiles…</p>
          : profiles.isError ? <div className="custom-tools-permission" role="alert"><div><h2>Profile management unavailable</h2><p>{issue(profiles.error)}</p></div><button className="button secondary" onClick={() => void profiles.refetch()}><RefreshCw size={14} /> Retry</button></div>
            : <>
              {encryptionStatus.data?.available === false && <div className="custom-tools-permission" role="alert"><div><h2>Credential encryption unavailable</h2><p>Configure the persistent backend secret LLM_CREDENTIALS_ENCRYPTION_KEY before connecting accounts or saving tool credentials.</p></div><button className="button secondary" onClick={() => void encryptionStatus.refetch()}><RefreshCw size={14} /> Check again</button></div>}
              {error && <div className="custom-tools-error" role="alert">{error}</div>}
              {notice && <p className="custom-tools-notice" role="status">{notice}</p>}
              <section className="connection-profiles-summary" aria-label="Profile summary">
                <div><span>Profiles</span><strong>{profiles.data?.length ?? 0}</strong></div>
                <div><span>Enabled</span><strong>{profiles.data?.filter((profile) => profile.enabled).length ?? 0}</strong></div>
                <div><span>Atomic ready</span><strong>{profiles.data?.filter((profile) => profile.authenticationCapabilities?.atomicPerUserLogin).length ?? 0}</strong></div>
              </section>
              {formOpen && <form className="connection-profile-editor" onSubmit={submit}>
                <div className="connection-profile-editor-heading"><div><span>{editing ? "PROFILE SETTINGS" : "NEW CONNECTION"}</span><h2>{editing ? `Edit ${draft.displayName || draft.id}` : "Add a connection profile"}</h2><p>Profiles keep destination hosts and authentication rules in one place.</p></div></div>
                <div className="connection-profile-fields">
                  {!editing && <label>Profile ID<input required pattern="[a-z][a-z0-9_-]{0,63}" maxLength={64} value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="billing_api" /><small>Lowercase letters, numbers, hyphens, and underscores.</small></label>}
                  <label>Display name<input required maxLength={120} value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} placeholder="Billing API" /></label>
                  <label className="connection-profile-url">Base URL<input required type="url" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.example.com/" /><small>Use the root origin for the approved service.</small></label>
                  <label className="connection-profile-enabled"><input type="checkbox" checked={draft.allowLocalHttp} onChange={(e) => setDraft({ ...draft, allowLocalHttp: e.target.checked })} /><span><strong>Allow local HTTP loopback</strong><small>Development only. Production always requires HTTPS; only localhost and loopback IPs are accepted.</small></span></label>
                  <label>Authentication strategy<select value={draft.authStrategy} onChange={(e) => setDraft({ ...draft, authStrategy: e.target.value as Draft["authStrategy"] })}><option value="NONE">None</option><option value="SHARED">Shared</option><option value="ATOMIC_COOKIE_REFRESH">Atomic email and password</option><option value="OAUTH2_REFRESH">OAuth2 refresh</option></select></label>
                  {draft.authStrategy === "OAUTH2_REFRESH" && <><label>Token URL<input required type="url" value={draft.tokenUrl} onChange={(e) => setDraft({ ...draft, tokenUrl: e.target.value })} /></label><label>Client ID<input required maxLength={512} value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })} /></label></>}
                </div>
                {editing && <label className="connection-profile-enabled"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /><span><strong>Profile enabled</strong><small>Disabled profiles cannot be selected by new or enabled tools.</small></span></label>}
                <div className="connection-profile-editor-footer"><button className="button secondary" type="button" onClick={() => { setDraft(empty); setEditing(""); setFormOpen(false); }}>Cancel</button><button className="button primary" disabled={save.isPending}>{save.isPending ? "Saving…" : editing ? "Save changes" : "Create profile"}</button></div>
              </form>}
              {(profiles.data ?? []).length === 0 ? <div className="connection-profiles-empty"><span className="connection-profiles-empty-icon"><Plus size={20} /></span><h2>No connection profiles yet</h2><p>Add a profile to give custom tools a server-approved host and authentication setup.</p><button className="button primary" onClick={() => { setEditing(""); setDraft(empty); setFormOpen(true); }}><Plus size={15} /> Add first profile</button></div> : <section className="connection-profiles-grid" aria-label="Connection profiles">
                {(profiles.data ?? []).map((profile) => <article className="connection-profile-card" key={profile.id}>
                  <div className="connection-profile-card-top"><div className="connection-profile-mark"><span>{(profile.displayName ?? profile.id).slice(0, 1).toUpperCase()}</span></div><div className="connection-profile-card-title"><h2>{profile.displayName ?? profile.id}</h2><code>{profile.id}</code></div><span className={`connection-profile-status ${profile.enabled ? "is-enabled" : "is-disabled"}`}><i />{profile.enabled ? "Enabled" : "Disabled"}</span></div>
                  <div className="connection-profile-host"><span>Base host</span><code>{profile.host}</code></div>
                  <div className="connection-profile-capabilities"><span className="connection-profile-strategy">{profile.authStrategy?.replaceAll("_", " ") ?? "NONE"}</span>{profile.authenticationCapabilities?.atomicPerUserLogin && <span className="connection-profile-capability">Atomic · per user</span>}{profile.authenticationCapabilities?.oauth2Refresh && <span className="connection-profile-capability">OAuth refresh</span>}</div>
                  <div className="connection-profile-card-footer"><button className="button secondary" onClick={() => editProfile(profile)}><Pencil size={14} /> Edit</button><button className="button secondary" onClick={() => setCredentialsProfile(credentialsProfile === profile.id ? "" : profile.id)}>{credentialsProfile === profile.id ? "Hide credentials" : "Credentials"}</button><button className="connection-profile-delete" aria-label={`Delete ${profile.displayName ?? profile.id}`} onClick={() => { if (window.confirm(`Delete connection profile “${profile.displayName ?? profile.id}”?`)) remove.mutate(profile.id); }} disabled={remove.isPending}><Trash2 size={15} /></button></div>
                  {credentialsProfile === profile.id && <section className="connection-profile-credentials"><div><h3>Shared connections</h3><p>Encrypted by the backend. Passwords and tokens are never shown here.</p></div>
                    {credentials.isPending ? <p>Loading credentials…</p> : credentials.isError ? <p role="alert">{issue(credentials.error)}</p> : (credentials.data ?? []).map((credential) => <div className="connection-profile-credential-row" key={credential.id}><strong>{credential.name}</strong><span>{credential.authStatus}</span><small>Expires {new Date(credential.tokenExpiresAt).toLocaleString()}</small></div>)}
                    <form onSubmit={(e) => void addSharedCredential(e)}><label>Connection name<input name="name" required pattern="[a-z][a-z0-9_-]{0,63}" maxLength={64} placeholder="service_account" /></label><label>Email<input name="email" required type="email" maxLength={254} autoComplete="username" /></label><label>Password<input name="password" required type="password" minLength={1} maxLength={1024} autoComplete="new-password" /></label><button className="button secondary" disabled={credentialBusy}>{credentialBusy ? "Connecting…" : "Add shared connection"}</button></form>
                    {credentialError && <p className="custom-tools-error" role="alert">{credentialError}</p>}
                  </section>}
                </article>)}
              </section>}
            </>}
    </main>
  );
}
