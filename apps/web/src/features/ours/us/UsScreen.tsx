import { type FormEvent, useEffect, useState } from "react";
import { accountMessageFor } from "../../../app/account-errors.ts";
import { THEME_LABELS, type ThemePreference } from "../../../design/theme-model.ts";
import { useTheme } from "../../../design/theme.tsx";
import {
  Button,
  ConfirmDialog,
  ErrorNotice,
  Notice,
  PairMark,
  Segmented,
  Skeleton,
  SkeletonGroup,
} from "../../../design/primitives.tsx";
import { apiRequest } from "../../../lib/api-client.ts";
import { PartnerRequestsPanel } from "../../partner-requests/PartnerRequestsPanel.tsx";
import { PartnershipPanel } from "../../partnership/PartnershipPanel.tsx";
import "../ours.css";

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

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = (
  ["system", "dawn", "midnight"] as const
).map((value) => ({ value, label: THEME_LABELS[value] }));

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

/**
 * Us (UX4): who we are, the partnership, requests, and the account. Presentation only. Every
 * existing action and confirmation is preserved: partnership lifecycle lives in
 * `PartnershipPanel`, requests in `PartnerRequestsPanel`, and account, security, devices, and
 * deletion below. Presence, typing, last seen, and read receipts are always on and are not
 * settings, so nothing here offers to change them.
 */
export function UsScreen({
  reauthenticatedAt,
  onSignedOut,
  refreshSession,
}: {
  readonly reauthenticatedAt: string | null;
  readonly onSignedOut: () => Promise<void>;
  readonly refreshSession: () => Promise<void>;
}) {
  const theme = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDeletion, setConfirmDeletion] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");

  const currentDevice = devices.find((device) => device.isCurrent) ?? null;

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
    void load().catch((caught) => setError(accountMessageFor(caught)));
  }, []);

  async function run(task: () => Promise<void>, success?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      if (success) setNotice(success);
    } catch (caught) {
      setError(accountMessageFor(caught));
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
      await onSignedOut();
    });
  }

  return (
    <div className="us">
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {!me ? (
        <SkeletonGroup label="Loading account">
          <Skeleton width="50%" />
          <Skeleton shape="block" />
        </SkeletonGroup>
      ) : (
        <section className="us-block" aria-label="You">
          <div className="us-identity">
            <PairMark together size={40} />
            <div className="us-identity__name">
              <strong>{me.displayName}</strong>
              <span className="muted">@{me.username}</span>
            </div>
            <Button compact onClick={() => void logout()} disabled={busy}>
              Sign out
            </Button>
          </div>
        </section>
      )}

      <div className="us-part">
        <p className="us-part__title">Us</p>
        <PartnershipPanel />
        <PartnerRequestsPanel />
      </div>

      {me ? (
        <div className="us-part">
          <p className="us-part__title">You</p>

          <section className="us-block">
            <h2>Appearance</h2>
            <Segmented
              label="Appearance"
              value={theme.preference}
              options={THEME_OPTIONS}
              onChange={theme.setPreference}
            />
          </section>

          <section className="us-block">
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
              <Button variant="primary" type="submit" disabled={busy}>
                Save display name
              </Button>
            </form>
          </section>

          <section className="us-block">
            <h2>Username</h2>
            <Field label="Username" name="usernameChange" value={username} onChange={setUsername} />
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await mutate("/api/v1/me/username", { username });
                  await load();
                }, "Username updated.")
              }
            >
              Change username
            </Button>
          </section>

          <section className="us-block">
            <h2>Date of birth</h2>
            <Field
              label="One-time correction"
              name="dateOfBirthCorrection"
              type="date"
              value={dateOfBirth}
              onChange={setDateOfBirth}
            />
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await mutate("/api/v1/me/date-of-birth-correction", { dateOfBirth });
                  await load();
                }, "Date of birth corrected.")
              }
            >
              Use correction
            </Button>
          </section>
        </div>
      ) : null}

      {me ? (
        <div className="us-part">
          <p className="us-part__title">Security</p>

          <section className="us-block">
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
              <Button type="submit" disabled={busy}>
                Confirm password
              </Button>
              <span className="hint">
                Last confirmed:{" "}
                {reauthenticatedAt ? new Date(reauthenticatedAt).toLocaleString() : "not recently"}
              </span>
            </form>
          </section>

          <section className="us-block">
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
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => mutate("/api/v1/me/email-change/start", { email: newEmail }),
                    "Verification code sent to the new email.",
                  )
                }
              >
                Send verification code
              </Button>
              <Field
                label="Verification code"
                name="emailCode"
                value={emailCode}
                onChange={setEmailCode}
                autoComplete="one-time-code"
              />
              <Button
                variant="primary"
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
              </Button>
            </div>
          </section>

          <section className="us-block">
            <h2>Devices</h2>
            <p className="hint">Revoking a device immediately revokes its active sessions.</p>
            <ul className="us-list">
              {devices.map((device) => (
                <li className="us-list__item" key={device.id}>
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
                    <div>
                      <Button
                        variant="danger"
                        compact
                        disabled={busy}
                        onClick={() =>
                          void run(
                            async () => {
                              await mutate(`/api/v1/me/devices/${device.id}`, undefined, "DELETE");
                              if (device.isCurrent) await onSignedOut();
                              else await load();
                            },
                            device.isCurrent ? undefined : "Device revoked.",
                          )
                        }
                      >
                        Revoke
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {currentDevice ? <p className="hint">Current device ID: {currentDevice.id}</p> : null}
          </section>
        </div>
      ) : null}

      {me ? (
        <section className="us-block us-danger">
          <h2>Delete account</h2>
          <p>
            Access is removed immediately. You have exactly seven days to recover the account by
            verified email.
          </p>
          <div>
            <Button variant="dangerQuiet" disabled={busy} onClick={() => setConfirmDeletion(true)}>
              Request account deletion
            </Button>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmDeletion}
        onCancel={() => setConfirmDeletion(false)}
        onConfirm={() => {
          setConfirmDeletion(false);
          void run(async () => {
            await mutate("/api/v1/me/account-deletion", {});
            await onSignedOut();
          });
        }}
        title="Request account deletion?"
        confirmLabel="Request account deletion"
        destructive
      >
        Request account deletion now? Access is removed immediately. You have exactly seven days to
        recover the account by verified email.
      </ConfirmDialog>
    </div>
  );
}
