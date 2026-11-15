import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api/client";
import { useAuth } from "../lib/auth/AuthProvider";

const ACCOUNT_COPY = {
  fallbackName: "Signed in account",
  loadingEmail: "Loading email…",
  missingEmail: "Email unavailable",
  emailError: "Could not load email",
};

export function AccountMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const accountProfile = useQuery({
    queryKey: ["auth-me", auth.session?.identity.userId],
    queryFn: ({ signal }) => api.currentAccount(signal),
    enabled: open && !!auth.session,
    retry: 0,
    staleTime: 300_000,
  });
  const accountUser = accountProfile.data?.user;
  const username = accountUser?.username;
  const isLegacyUsername = username?.startsWith("legacy-") ?? false;
  const accountEmail =
    accountUser?.emailDisplay ||
    accountUser?.email ||
    auth.session?.identity.email;
  const accountName =
    accountUser?.displayName ||
    accountEmail ||
    (isLegacyUsername ? undefined : username) ||
    ACCOUNT_COPY.fallbackName;

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      )
        menuRef.current?.removeAttribute("open");
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") menuRef.current?.removeAttribute("open");
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <details
      ref={menuRef}
      className="account-menu"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="avatar avatar-small" aria-label="Open account menu">
        {accountName.slice(0, 2).toUpperCase()}
      </summary>
      <div className="account-popover">
        <div className="account-popover-title">
          <span>Signed in</span>
          <b>{accountName}</b>
        </div>
        <div className="account-person">
          <span className="account-person-avatar">
            {accountName.slice(0, 1).toUpperCase()}
          </span>
          <span className="account-person-copy">
            <b>{accountName}</b>
            <small>
              {accountEmail ||
                (accountProfile.isPending
                  ? ACCOUNT_COPY.loadingEmail
                  : accountProfile.isError
                    ? ACCOUNT_COPY.emailError
                    : ACCOUNT_COPY.missingEmail)}
            </small>
            {accountProfile.isError && (
              <button
                className="account-profile-retry"
                type="button"
                onClick={() => void accountProfile.refetch()}
              >
                Retry
              </button>
            )}
          </span>
        </div>
        <button
          className="account-signout"
          type="button"
          onClick={() => void auth.signOut()}
        >
          Sign out
        </button>
      </div>
    </details>
  );
}
