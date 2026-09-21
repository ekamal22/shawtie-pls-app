import { useEffect, useState } from "react";
import { ApiClientError, apiRequest } from "../../lib/api-client.ts";
import { NotificationsPanel } from "../notifications/NotificationsPanel.tsx";

interface CurrentPartnership {
  partnershipId: string;
  lifecycleState: "active" | "breakup_pending";
  activatedAt: string;
  relationshipStartDate: string;
  metadataVersion: number;
  capabilities: {
    changeRelationshipStartDate: boolean;
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
    PARTNERSHIP_METADATA_LOCKED: "Relationship details are temporarily view-only.",
    PARTNERSHIP_UNAVAILABLE: "That partnership is not available.",
    RELATIONSHIP_DATE_FUTURE: "The relationship start date cannot be in the future.",
    VERSION_CONFLICT: "The relationship details changed. Refresh and try again.",
  };
  return known[error.code] ?? error.code.replaceAll("_", " ").toLowerCase();
}

export function PartnershipPanel() {
  const [partnership, setPartnership] = useState<CurrentPartnership | null | undefined>(undefined);
  const [relationshipStartDate, setRelationshipStartDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await apiRequest<{ partnership: CurrentPartnership | null }>(
      "/api/v1/partnerships/current",
    );
    setPartnership(response.partnership);
    setRelationshipStartDate(response.partnership?.relationshipStartDate ?? "");
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

  async function updateRelationshipDate() {
    if (!partnership || !relationshipStartDate) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{
        relationshipStartDate: string;
        metadataVersion: number;
        changed: boolean;
      }>(
        `/api/v1/partnerships/${partnership.partnershipId}/relationship-start-date`,
        {
          method: "PATCH",
          body: {
            relationshipStartDate,
            expectedMetadataVersion: partnership.metadataVersion,
          },
        },
      );
      setNotice(
        result.changed ? "Relationship start date updated." : "Relationship date is current.",
      );
      await load();
      window.dispatchEvent(new Event("shawtie:notifications-changed"));
    } catch (caught) {
      setError(errorMessage(caught));
      if (caught instanceof ApiClientError && caught.code === "VERSION_CONFLICT") {
        await load().catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  if (partnership === undefined) {
    return (
      <section className="panel">
        <h2>Partnership</h2>
        <p className="muted">Loading partnership...</p>
      </section>
    );
  }

  if (!partnership) {
    return (
      <section className="panel">
        <h2>Partnership</h2>
        <p className="muted">No active partnership yet.</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <h2>Partnership</h2>
        {error ? <p className="banner error">{error}</p> : null}
        {notice ? <p className="banner success">{notice}</p> : null}
        <div className="stack">
          <div>
            <strong>{partnership.otherMember.displayName}</strong>
            <p className="muted">@{partnership.otherMember.username}</p>
          </div>
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
          <button
            className="primary"
            type="button"
            disabled={
              busy ||
              !partnership.capabilities.changeRelationshipStartDate ||
              !relationshipStartDate
            }
            onClick={() => void updateRelationshipDate()}
          >
            Save relationship date
          </button>
          {!partnership.capabilities.changeRelationshipStartDate ? (
            <p className="hint">Relationship metadata is currently view-only.</p>
          ) : null}
        </div>
      </section>
      <NotificationsPanel />
    </>
  );
}
