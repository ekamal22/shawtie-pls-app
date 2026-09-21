import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiClientError, apiRequest } from "../lib/api-client.ts";
import { PartnerRequestsPanel } from "../features/partner-requests/PartnerRequestsPanel.tsx";

interface Session {
  authenticated: true;
  accountId: string;
  sessionId: string;
  deviceId: string | null;
  reauthenticatedAt: string | null;
}

interface Me {
  accountId: string;
  username: string;
  displayName: string;
  dateOfBirth: string;
  status: string;
  email: string;
}

interface Device {
  id: string;
  displayName: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  activeSessionCount: number;
  isCurrent: boolean;
}

type AuthMode = "login" | "register" | "password-recovery" | "account-recovery";

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) {
    const known: Record<string, string> = {
      AGE_INELIGIBLE: "You must be at least 18 years old.",
      AUTH_INVALID: "The email/username or password is incorrect.",
      AUTH_REQUIRED: "Please sign in again.",
      CONFLICT: "The account changed while this request was running. Try again.",
      DOB_CORRECTION_ALREADY_USED: "The date-of-birth correction was already used.",
      EMAIL_CHALLENGE_EXPIRED: "That verification code expired. Request a new one.",
      EMAIL_CHALLENGE_INVALID: "That verification code is invalid.",
      EMAIL_UNAVAILABLE: "That email address cannot be used.",
      PASSWORD_COMMON: "Choose a less common password.",
      PASSWORD_TOO_LONG: "That password is too long.",
      PASSWORD_TOO_SHORT: "Use at least 15 characters.",
      RATE_LIMITED: "Too many attempts. Try again later.",
      REAUTH_REQUIRED: "Re-enter your password before this security-sensitive change.",
      USERNAME_CHANGE_NOT_ALLOWED: "The username cannot be changed right now.",
      USERNAME_INVALID: "Use 3-30 letters, numbers, dots, or underscores.",
      USERNAME_RESERVED: "That username is reserved.",
      USERNAME_UNAVAILABLE: "That username is unavailable.",
    };
    return known[error.code] ?? error.code.replaceAll("_", " ").toLowerCase();
  }
  return "Something went wrong.";
}

function Field({
  label,
  name,
  type = "text",
  value,
  onChange,
  autoComplete,
  required = true,
}: {
  label: string;
  name: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required={required}
      />
    </label>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [email, setEmail] = useState("");
  const [registrationIntentId, setRegistrationIntentId] = useState("");

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await apiRequest("/api/v1/auth/login", {
        method: "POST",
        body: { identifier, password, deviceName: "Browser" },
      });
      await onAuthenticated();
    });
  }

  async function startRegistration(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await apiRequest<{ registrationIntentId: string }>(
        "/api/v1/auth/registration/start",
        {
          method: "POST",
          body: { username, displayName, dateOfBirth, email, password },
        },
      );
      setRegistrationIntentId(result.registrationIntentId);
      setNotice("Verification code sent. Enter it below.");
    });
  }

  async function finishRegistration(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await apiRequest("/api/v1/auth/registration/verify", {
        method: "POST",
        body: { registrationIntentId, code, deviceName: "Browser" },
      });
      await onAuthenticated();
    });
  }

  async function resendRegistration() {
    await run(async () => {
      await apiRequest("/api/v1/auth/registration/resend", {
        method: "POST",
        body: { registrationIntentId },
      });
      setNotice("A new verification code was sent.");
    });
  }

  async function startRecovery(kind: "password" | "account") {
    await run(async () => {
      await apiRequest(`/api/v1/auth/${kind}-recovery/start`, {
        method: "POST",
        body: { identifier },
      });
      setNotice("If the account is eligible, a verification code was sent.");
    });
  }

  async function completeRecovery(kind: "password" | "account") {
    await run(async () => {
      if (kind === "password") {
        await apiRequest("/api/v1/auth/password-recovery/complete", {
          method: "POST",
          body: { identifier, code, newPassword },
        });
        setNotice("Password changed. Sign in with the new password.");
        setMode("login");
        setPassword("");
      } else {
        await apiRequest("/api/v1/auth/account-recovery/complete", {
          method: "POST",
          body: { identifier, code },
        });
        setNotice("Account recovered. Sign in normally.");
        setMode("login");
      }
      setCode("");
    });
  }

  return (
    <main className="shell auth-shell">
      <section className="brand">
        <div className="brand-mark" aria-hidden="true">
          S
        </div>
        <div>
          <h1>Shawtie pls</h1>
          <p>Your private space for just the two of you.</p>
        </div>
      </section>

      <section className="panel">
        <nav className="tabs" aria-label="Account actions">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Sign in
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            Create account
          </button>
        </nav>

        {error ? <p className="banner error">{error}</p> : null}
        {notice ? <p className="banner success">{notice}</p> : null}

        {mode === "login" ? (
          <form onSubmit={login} className="stack">
            <Field
              label="Username or email"
              name="identifier"
              value={identifier}
              onChange={setIdentifier}
              autoComplete="username"
            />
            <Field
              label="Password"
              name="password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
            <button className="primary" disabled={busy}>
              Sign in
            </button>
            <button type="button" className="link" onClick={() => setMode("password-recovery")}>
              Forgot password?
            </button>
            <button type="button" className="link" onClick={() => setMode("account-recovery")}>
              Recover an account pending deletion
            </button>
          </form>
        ) : null}

        {mode === "register" && !registrationIntentId ? (
          <form onSubmit={startRegistration} className="stack">
            <Field
              label="Username"
              name="username"
              value={username}
              onChange={setUsername}
              autoComplete="username"
            />
            <Field
              label="Display name"
              name="displayName"
              value={displayName}
              onChange={setDisplayName}
              autoComplete="name"
            />
            <Field
              label="Date of birth"
              name="dateOfBirth"
              type="date"
              value={dateOfBirth}
              onChange={setDateOfBirth}
              autoComplete="bday"
            />
            <Field
              label="Email"
              name="email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />
            <Field
              label="Password"
              name="newPassword"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
            <p className="hint">Use at least 15 characters. No forced symbol or uppercase rules.</p>
            <button className="primary" disabled={busy}>
              Send verification code
            </button>
          </form>
        ) : null}

        {mode === "register" && registrationIntentId ? (
          <form onSubmit={finishRegistration} className="stack">
            <Field
              label="8-digit verification code"
              name="code"
              value={code}
              onChange={setCode}
              autoComplete="one-time-code"
            />
            <button className="primary" disabled={busy}>
              Verify and create account
            </button>
            <button
              type="button"
              className="secondary"
              onClick={resendRegistration}
              disabled={busy}
            >
              Resend code
            </button>
          </form>
        ) : null}

        {mode === "password-recovery" ? (
          <div className="stack">
            <Field
              label="Username or email"
              name="recoveryIdentifier"
              value={identifier}
              onChange={setIdentifier}
              autoComplete="username"
            />
            <button
              className="secondary"
              onClick={() => void startRecovery("password")}
              disabled={busy}
            >
              Send recovery code
            </button>
            <Field
              label="Verification code"
              name="recoveryCode"
              value={code}
              onChange={setCode}
              autoComplete="one-time-code"
            />
            <Field
              label="New password"
              name="recoveryPassword"
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
            />
            <button
              className="primary"
              onClick={() => void completeRecovery("password")}
              disabled={busy}
            >
              Reset password
            </button>
            <button className="link" onClick={() => setMode("login")}>
              Back to sign in
            </button>
          </div>
        ) : null}

        {mode === "account-recovery" ? (
          <div className="stack">
            <Field
              label="Username or email"
              name="accountRecoveryIdentifier"
              value={identifier}
              onChange={setIdentifier}
              autoComplete="username"
            />
            <button
              className="secondary"
              onClick={() => void startRecovery("account")}
              disabled={busy}
            >
              Send account recovery code
            </button>
            <Field
              label="Verification code"
              name="accountRecoveryCode"
              value={code}
              onChange={setCode}
              autoComplete="one-time-code"
            />
            <button
              className="primary"
              onClick={() => void completeRecovery("account")}
              disabled={busy}
            >
              Recover account
            </button>
            <button className="link" onClick={() => setMode("login")}>
              Back to sign in
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function AccountScreen({
  session,
  onSignedOut,
  refreshSession,
}: {
  session: Session;
  onSignedOut: () => void;
  refreshSession: () => Promise<void>;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");

  const currentDevice = useMemo(
    () => devices.find((device) => device.isCurrent) ?? null,
    [devices],
  );

  async function load() {
    const [profile, deviceResult] = await Promise.all([
      apiRequest<Me>("/api/v1/me"),
      apiRequest<{ devices: Device[] }>("/api/v1/me/devices"),
    ]);
    setMe(profile);
    setDisplayName(profile.displayName);
    setUsername(profile.username);
    setDateOfBirth(profile.dateOfBirth);
    setDevices(deviceResult.devices);
  }

  useEffect(() => {
    void load().catch((caught) => setError(messageFor(caught)));
  }, []);

  async function run(task: () => Promise<void>, success?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      if (success) setNotice(success);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function mutate(
    path: string,
    body?: unknown,
    method: "POST" | "PATCH" | "DELETE" = "POST",
  ) {
    await apiRequest(path, { method, ...(body !== undefined ? { body } : {}) });
  }

  async function reauthenticate(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await mutate("/api/v1/auth/reauthenticate", { password: reauthPassword });
      setReauthPassword("");
      await refreshSession();
    }, "Security confirmation refreshed for 10 minutes.");
  }

  async function logout() {
    await run(async () => {
      await mutate("/api/v1/auth/logout");
      onSignedOut();
    });
  }

  if (!me) {
    return (
      <main className="shell">
        <section className="panel">
          <p>{error || "Loading account..."}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <strong>{me.displayName}</strong>
          <span>@{me.username}</span>
        </div>
        <button className="secondary compact" onClick={() => void logout()} disabled={busy}>
          Sign out
        </button>
      </header>

      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner success">{notice}</p> : null}

      <PartnerRequestsPanel />

      <section className="panel">
        <h2>Account</h2>
        <p className="muted">{me.email}</p>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await mutate("/api/v1/me/profile", { displayName }, "PATCH");
              await load();
            }, "Display name updated.");
          }}
        >
          <Field
            label="Display name"
            name="profileDisplayName"
            value={displayName}
            onChange={setDisplayName}
          />
          <button className="primary" disabled={busy}>
            Save display name
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Security confirmation</h2>
        <p className="hint">
          Email changes and account deletion require a recent password confirmation.
        </p>
        <form className="stack" onSubmit={reauthenticate}>
          <Field
            label="Current password"
            name="reauthPassword"
            type="password"
            value={reauthPassword}
            onChange={setReauthPassword}
            autoComplete="current-password"
          />
          <button className="secondary" disabled={busy}>
            Confirm password
          </button>
          <span className="hint">
            Last confirmed:{" "}
            {session.reauthenticatedAt
              ? new Date(session.reauthenticatedAt).toLocaleString()
              : "not recently"}
          </span>
        </form>
      </section>

      <section className="panel">
        <h2>Verified email</h2>
        <div className="stack">
          <Field
            label="New email"
            name="newEmail"
            type="email"
            value={newEmail}
            onChange={setNewEmail}
            autoComplete="email"
          />
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(
                () => mutate("/api/v1/me/email-change/start", { email: newEmail }),
                "Verification code sent to the new email.",
              )
            }
          >
            Send verification code
          </button>
          <Field
            label="Verification code"
            name="emailCode"
            value={emailCode}
            onChange={setEmailCode}
            autoComplete="one-time-code"
          />
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await mutate("/api/v1/me/email-change/complete", { code: emailCode });
                setEmailCode("");
                setNewEmail("");
                await Promise.all([load(), refreshSession()]);
              }, "Email changed. Other sessions were revoked.")
            }
          >
            Confirm new email
          </button>
        </div>
      </section>

      <section className="panel two-column">
        <div className="stack">
          <h2>Username</h2>
          <Field label="Username" name="usernameChange" value={username} onChange={setUsername} />
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await mutate("/api/v1/me/username", { username });
                await load();
              }, "Username updated.")
            }
          >
            Change username
          </button>
        </div>
        <div className="stack">
          <h2>Date of birth</h2>
          <Field
            label="One-time correction"
            name="dateOfBirthCorrection"
            type="date"
            value={dateOfBirth}
            onChange={setDateOfBirth}
          />
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await mutate("/api/v1/me/date-of-birth-correction", { dateOfBirth });
                await load();
              }, "Date of birth corrected.")
            }
          >
            Use correction
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Devices</h2>
        <p className="hint">Revoking a device immediately revokes its active sessions.</p>
        <div className="device-list">
          {devices.map((device) => (
            <article className="device" key={device.id}>
              <div>
                <strong>{device.displayName}</strong>
                {device.isCurrent ? <span className="pill">This device</span> : null}
                <p className="muted">
                  {device.revokedAt
                    ? `Revoked ${new Date(device.revokedAt).toLocaleString()}`
                    : `${device.activeSessionCount} active session(s)`}
                </p>
              </div>
              {!device.revokedAt ? (
                <button
                  className="danger compact"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      async () => {
                        await mutate(`/api/v1/me/devices/${device.id}`, undefined, "DELETE");
                        if (device.isCurrent) onSignedOut();
                        else await load();
                      },
                      device.isCurrent ? undefined : "Device revoked.",
                    )
                  }
                >
                  Revoke
                </button>
              ) : null}
            </article>
          ))}
        </div>
        {currentDevice ? <p className="hint">Current device ID: {currentDevice.id}</p> : null}
      </section>

      <section className="panel danger-zone">
        <h2>Delete account</h2>
        <p>
          Access is removed immediately. You have exactly seven days to recover the account by
          verified email.
        </p>
        <button
          className="danger"
          disabled={busy}
          onClick={() => {
            if (!window.confirm("Request account deletion now?")) return;
            void run(async () => {
              await mutate("/api/v1/me/account-deletion", {});
              onSignedOut();
            });
          }}
        >
          Request account deletion
        </button>
      </section>
    </main>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  async function refreshSession() {
    try {
      setSession(await apiRequest<Session>("/api/v1/auth/session"));
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setSession(null);
        return;
      }
      throw error;
    }
  }

  useEffect(() => {
    void refreshSession().catch(() => setSession(null));
  }, []);

  if (session === undefined) {
    return (
      <main className="shell auth-shell">
        <section className="panel">
          <p>Loading Shawtie pls...</p>
        </section>
      </main>
    );
  }

  return session ? (
    <AccountScreen
      session={session}
      onSignedOut={() => setSession(null)}
      refreshSession={refreshSession}
    />
  ) : (
    <AuthScreen onAuthenticated={refreshSession} />
  );
}
