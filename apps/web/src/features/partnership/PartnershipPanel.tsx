import { useEffect, useState } from "react";
import { ApiClientError, apiRequest } from "../../lib/api-client.ts";
import { useM2Runtime } from "../../lib/realtime/runtime-context.tsx";
import { Avatar, Button, ConfirmDialog } from "../../design/primitives.tsx";
import { NotificationsPanel } from "../notifications/NotificationsPanel.tsx";
import { FormerPartnershipsPanel } from "./FormerPartnershipsPanel.tsx";

interface CurrentPartnership {
  partnershipId: string;
  lifecycleState: "active" | "breakup_pending";
  interactionMode: "normal" | "breakup_restricted" | "account_deletion_view_only";
  activatedAt: string;
  relationshipStartDate: string;
  metadataVersion: number;
  generation: number;
  breakup: {
    breakupId: string;
    initiatedBy: "self" | "partner";
    initiatedAt: string;
    initiatorCancelUntil: string;
    baseDeadline: string;
    finalDeadline: string;
    selfRestoreIntentAt: string | null;
    partnerRestoreIntentAt: string | null;
  } | null;
  accountDeletion: {
    deletingMember: "self" | "partner";
    recoverUntil: string;
  } | null;
  capabilities: {
    changeRelationshipStartDate: boolean;
    initiateBreakup: boolean;
    cancelBreakup: boolean;
    submitRestoreIntent: boolean;
    viewSharedData: boolean;
  };
  otherMember: {
    accountId: string;
    username: string;
    displayName: string;
  };
}

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return "Something went wrong.";
  const known: Record<string, string> = {
    ACCOUNT_LOCKED: "This partnership is temporarily view-only.",
    BREAKUP_DEADLINE_EXPIRED: "The breakup deadline has already arrived.",
    BREAKUP_REQUIRED: "That breakup action is no longer available.",
    BREAKUP_WINDOW_EXPIRED: "The one-hour cancellation window has ended.",
    IDEMPOTENCY_KEY_REUSED: "That action changed. Please try again.",
    NOT_BREAKUP_INITIATOR: "Only the partner who started the breakup can cancel it directly.",
    PARTNERSHIP_METADATA_LOCKED: "Relationship details are temporarily view-only.",
    PARTNERSHIP_UNAVAILABLE: "That partnership is not available.",
    RELATIONSHIP_DATE_FUTURE: "The relationship start date cannot be in the future.",
    RESTORE_INTENT_ALREADY_SUBMITTED: "Your restore request is already recorded.",
    RESTORE_WINDOW_NOT_OPEN: "Restore becomes available after the one-hour cancellation window.",
    VERSION_CONFLICT: "The relationship details changed. Refresh and try again.",
  };
  return known[error.code] ?? error.code.replaceAll("_", " ").toLowerCase();
}

function deadlineLabel(value: string): string {
  return new Date(value).toLocaleString();
}

export function PartnershipPanel() {
  const runtime = useM2Runtime();
  const [partnership, setPartnership] = useState<CurrentPartnership | null | undefined>(undefined);
  const [relationshipStartDate, setRelationshipStartDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<"breakup" | "restore" | null>(null);

  async function load() {
    const response = await apiRequest<{ partnership: CurrentPartnership | null }>(
      "/api/v1/partnerships/current",
    );
    setPartnership(response.partnership);
    setRelationshipStartDate(response.partnership?.relationshipStartDate ?? "");
    setError("");
    window.dispatchEvent(
      new CustomEvent("shawtie:partnership-mode", {
        detail: { occupied: Boolean(response.partnership) },
      }),
    );
  }

  useEffect(() => {
    void load().catch((caught) => setError(errorMessage(caught)));
    const onPartnershipChanged = () => {
      void load().catch((caught) => setError(errorMessage(caught)));
    };
    window.addEventListener("shawtie:partnership-changed", onPartnershipChanged);
    window.addEventListener("focus", onPartnershipChanged);
    return () => {
      window.removeEventListener("shawtie:partnership-changed", onPartnershipChanged);
      window.removeEventListener("focus", onPartnershipChanged);
    };
  }, []);

  useEffect(
    () =>
      runtime.registerSynchronizer("partnership", async () => {
        await load();
      }),
    [runtime],
  );

  useEffect(() => {
    if (!partnership?.breakup) return;
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [partnership?.breakup?.breakupId]);

  async function runMutation(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      await load();
      window.dispatchEvent(new Event("shawtie:partnership-changed"));
      window.dispatchEvent(new Event("shawtie:notifications-changed"));
    } catch (caught) {
      setError(errorMessage(caught));
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function updateRelationshipDate() {
    if (!partnership || !relationshipStartDate) return;
    await runMutation(async () => {
      const result = await apiRequest<{
        relationshipStartDate: string;
        metadataVersion: number;
        changed: boolean;
      }>("/api/v1/partnerships/" + partnership.partnershipId + "/relationship-start-date", {
        method: "PATCH",
        body: {
          relationshipStartDate,
          expectedMetadataVersion: partnership.metadataVersion,
        },
      });
      setNotice(
        result.changed ? "Relationship start date updated." : "Relationship date is current.",
      );
    });
  }

  async function initiateBreakup() {
    if (!partnership || !partnership.capabilities.initiateBreakup) return;
    await runMutation(async () => {
      await apiRequest("/api/v1/partnerships/" + partnership.partnershipId + "/breakup", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      setNotice("Breakup process started.");
    });
  }

  async function cancelBreakup() {
    const current = partnership;
    const breakup = current?.breakup;
    if (!current || !breakup || !current.capabilities.cancelBreakup) return;
    await runMutation(async () => {
      await apiRequest(
        "/api/v1/partnerships/" +
          current.partnershipId +
          "/breakups/" +
          breakup.breakupId +
          "/cancel",
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
        },
      );
      setNotice("Breakup cancelled.");
    });
  }

  async function restorePartnership() {
    const current = partnership;
    const breakup = current?.breakup;
    if (!current || !breakup || !current.capabilities.submitRestoreIntent) return;
    await runMutation(async () => {
      const result = await apiRequest<{ restored: boolean }>(
        "/api/v1/partnerships/" +
          current.partnershipId +
          "/breakups/" +
          breakup.breakupId +
          "/restore",
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
        },
      );
      setNotice(
        result.restored
          ? "Your partnership has been restored."
          : "Your restore request is recorded. Waiting for your partner.",
      );
    });
  }

  let content;
  if (partnership === undefined) {
    content = <p className="muted">Loading partnership...</p>;
  } else if (!partnership) {
    content = <p className="muted">No active partnership yet.</p>;
  } else {
    const breakup = partnership.breakup;
    content = (
      <div className="stack">
        <div className="us-identity">
          <Avatar name={partnership.otherMember.displayName} size={44} />
          <div className="us-identity__name">
            <strong>{partnership.otherMember.displayName}</strong>
            <span className="muted">@{partnership.otherMember.username}</span>
          </div>
        </div>

        {partnership.accountDeletion ? (
          <div className="us-lifecycle" role="status">
            <p>
              This partnership is view-only while{" "}
              {partnership.accountDeletion.deletingMember === "self" ? "your" : "your partner's"}{" "}
              account deletion is pending. Recovery closes at{" "}
              {deadlineLabel(partnership.accountDeletion.recoverUntil)}.
            </p>
          </div>
        ) : null}

        {breakup ? (
          <div className="us-lifecycle">
            <strong>Breakup in progress</strong>
            <p>
              {breakup.initiatedBy === "self" ? "You started" : "Your partner started"} this process
              on {deadlineLabel(breakup.initiatedAt)}.
            </p>
            <p className="hint">Current final deadline: {deadlineLabel(breakup.finalDeadline)}</p>
            {partnership.capabilities.cancelBreakup ? (
              <div>
                <Button disabled={busy} onClick={() => void cancelBreakup()}>
                  Cancel breakup
                </Button>
              </div>
            ) : null}
            {breakup.selfRestoreIntentAt ? (
              <p className="hint">
                Your restore request is final for this breakup. Waiting for your partner.
              </p>
            ) : partnership.capabilities.submitRestoreIntent ? (
              <div>
                <Button variant="primary" disabled={busy} onClick={() => setConfirming("restore")}>
                  Restore partnership
                </Button>
              </div>
            ) : (
              <p className="hint">
                Restore becomes available after the one-hour cancellation window if the breakup is
                still pending.
              </p>
            )}
            {breakup.partnerRestoreIntentAt ? (
              <p className="hint">Your partner has already requested restoration.</p>
            ) : null}
          </div>
        ) : null}

        <p className="hint">
          Active in Shawtie pls since {new Date(partnership.activatedAt).toLocaleString()}.
        </p>
        <label className="field">
          <span>Relationship start date</span>
          <input
            type="date"
            value={relationshipStartDate}
            max={new Date().toISOString().slice(0, 10)}
            disabled={!partnership.capabilities.changeRelationshipStartDate || busy}
            onChange={(event) => setRelationshipStartDate(event.target.value)}
          />
        </label>
        <div>
          <Button
            variant="primary"
            disabled={
              busy ||
              !partnership.capabilities.changeRelationshipStartDate ||
              !relationshipStartDate
            }
            onClick={() => void updateRelationshipDate()}
          >
            Save relationship date
          </Button>
        </div>
        {!partnership.capabilities.changeRelationshipStartDate ? (
          <p className="hint">Relationship metadata is currently view-only.</p>
        ) : null}

        {partnership.capabilities.initiateBreakup ? (
          <div>
            <Button variant="dangerQuiet" disabled={busy} onClick={() => setConfirming("breakup")}>
              Start breakup
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <section className="us-block">
        <h2>Partnership</h2>
        {error ? (
          <p className="banner error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="banner success" role="status">
            {notice}
          </p>
        ) : null}
        {content}
      </section>
      <FormerPartnershipsPanel />
      <NotificationsPanel />

      <ConfirmDialog
        open={confirming === "breakup"}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          void initiateBreakup();
        }}
        title="Start the breakup process?"
        confirmLabel="Start breakup"
        destructive
      >
        Start the breakup process? You can cancel directly only during the first hour.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming === "restore"}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          void restorePartnership();
        }}
        title="Restore the partnership?"
        confirmLabel="Submit restore request"
      >
        Submit your restore request? It cannot be withdrawn during this breakup process.
      </ConfirmDialog>
    </>
  );
}
