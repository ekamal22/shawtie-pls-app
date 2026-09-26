import { type FormEvent, useEffect, useState } from "react";
import { ApiClientError, apiRequest } from "../lib/api-client.ts";
import { broadcastLocalLogout } from "../lib/offline/account-control.ts";
import {
  purgeAccountLocalData,
  rememberLocalAccount,
  rememberedLocalAccount,
} from "../lib/offline/local-db.ts";
import {
  closeActiveM2Runtime,
  M2QueueStatus,
  M2RuntimeProvider,
  M2UpdateBanner,
} from "../lib/realtime/runtime-context.tsx";
import { MessagingPanel } from "../features/messaging/MessagingPanel.tsx";
import { OursScreen } from "../features/ours/OursScreen.tsx";
import { UsScreen } from "../features/ours/us/UsScreen.tsx";
import { CallingPanel } from "../features/calling/CallingPanel.tsx";
import { HomeScreen } from "../features/home/HomeScreen.tsx";
import { Button, LifecycleBanner } from "../design/primitives.tsx";
import { accountMessageFor } from "./account-errors.ts";
import { AppShell, RouteView } from "./shell/AppShell.tsx";
import { useRoute } from "./shell/routes.ts";
import { useConversationContext } from "./shell/useConversationContext.ts";

interface Session {
  authenticated: true;
  accountId: string;
  sessionId: string;
  deviceId: string | null;
  reauthenticatedAt: string | null;
}

type AuthMode = "login" | "register" | "password-recovery" | "account-recovery";

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
      setError(accountMessageFor(caught));
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
  onSignedOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}) {
  const [route, navigate] = useRoute();
  useEffect(() => {
    // Memory Return: opening a source message from Ours brings Talk forward.
    const toTalk = () => navigate("talk");
    window.addEventListener("shawtie:open-message", toTalk);
    return () => window.removeEventListener("shawtie:open-message", toTalk);
  }, [navigate]);
  const conversation = useConversationContext();

  const lifecycleBanner =
    conversation && conversation.interactionMode === "account_deletion_view_only" ? (
      <LifecycleBanner
        title="View-only for now"
        action={
          <Button compact onClick={() => navigate("us")}>
            Details
          </Button>
        }
      >
        Account deletion is pending, so shared content can be viewed but not changed.
      </LifecycleBanner>
    ) : conversation && conversation.interactionMode === "breakup_restricted" ? (
      <LifecycleBanner
        title="Breakup process in progress"
        action={
          <Button compact onClick={() => navigate("us")}>
            Details
          </Button>
        }
      >
        Shared content is view-only. Dates and options are in Us.
      </LifecycleBanner>
    ) : null;

  return (
    <AppShell
      route={route}
      onNavigate={navigate}
      status={
        <>
          <M2UpdateBanner />
          <M2QueueStatus />
          {lifecycleBanner}
        </>
      }
      calls={<CallingPanel deviceId={session.deviceId} />}
      partnerOnline={conversation?.partner.presence.online === true}
    >
      <RouteView active={route === "home"}>
        <HomeScreen context={conversation} accountId={session.accountId} onNavigate={navigate} />
      </RouteView>
      <RouteView active={route === "talk"} keepMounted>
        <MessagingPanel active={route === "talk"} />
      </RouteView>
      <RouteView active={route === "ours"}>
        <OursScreen accountId={session.accountId} onOpenUs={() => navigate("us")} />
      </RouteView>
      <RouteView active={route === "us"}>
        <UsScreen
          reauthenticatedAt={session.reauthenticatedAt}
          onSignedOut={onSignedOut}
          refreshSession={refreshSession}
        />
      </RouteView>
    </AppShell>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined | "offline-locked">(undefined);

  async function refreshSession() {
    try {
      const current = await apiRequest<Session>("/api/v1/auth/session");
      const previousAccountId = rememberedLocalAccount();
      if (previousAccountId && previousAccountId !== current.accountId) {
        broadcastLocalLogout(previousAccountId);
        await closeActiveM2Runtime(previousAccountId);
        await purgeAccountLocalData(previousAccountId);
      }
      rememberLocalAccount(current.accountId);
      setSession(current);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        const revokedAccountId = rememberedLocalAccount();
        if (revokedAccountId) {
          broadcastLocalLogout(revokedAccountId);
          await closeActiveM2Runtime(revokedAccountId);
        }
        setSession(null);
        if (revokedAccountId) {
          await purgeAccountLocalData(revokedAccountId).catch(() => undefined);
        }
        return;
      }
      throw error;
    }
  }

  useEffect(() => {
    void refreshSession().catch(() => setSession("offline-locked"));
    const retryOnline = () => {
      void refreshSession().catch(() => setSession("offline-locked"));
    };
    const localLogout = (event: Event) => {
      const accountId = (event as CustomEvent<string>).detail;
      setSession(null);
      if (accountId) {
        void purgeAccountLocalData(accountId).catch(() => undefined);
      }
    };
    window.addEventListener("online", retryOnline);
    window.addEventListener("shawtie:security-changed", retryOnline);
    window.addEventListener("shawtie:local-logout", localLogout);
    return () => {
      window.removeEventListener("online", retryOnline);
      window.removeEventListener("shawtie:security-changed", retryOnline);
      window.removeEventListener("shawtie:local-logout", localLogout);
    };
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

  if (session === "offline-locked") {
    return (
      <main className="shell auth-shell">
        <section className="panel">
          <h1>Offline</h1>
          <p>
            Connect once so Shawtie pls can verify this private session before opening locally
            cached content.
          </p>
          <button className="primary" onClick={() => void refreshSession().catch(() => undefined)}>
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (!session) {
    return <AuthScreen onAuthenticated={refreshSession} />;
  }

  const signedOutAccountId = session.accountId;
  return (
    <M2RuntimeProvider accountId={session.accountId}>
      <AccountScreen
        session={session}
        onSignedOut={async () => {
          broadcastLocalLogout(signedOutAccountId);
          await closeActiveM2Runtime(signedOutAccountId);
          await purgeAccountLocalData(signedOutAccountId);
          setSession(null);
        }}
        refreshSession={refreshSession}
      />
    </M2RuntimeProvider>
  );
}
