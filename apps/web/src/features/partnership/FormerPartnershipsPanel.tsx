import { useEffect, useState } from "react";
import { ApiClientError, apiRequest } from "../../lib/api-client.ts";

interface FormerPartnership {
  partnershipId: string;
  terminatedAt: string;
  terminationReason: "breakup" | "partner_account_deleted";
  formerPartner: {
    accountId: string;
    username: string;
    displayName: string;
  } | null;
  blockedByMe: boolean;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return "Something went wrong.";
  const known: Record<string, string> = {
    BLOCK_NOT_AVAILABLE: "Blocking is not available for that former partnership.",
    PARTNERSHIP_UNAVAILABLE: "That former partnership is not available.",
  };
  return known[error.code] ?? error.code.replaceAll("_", " ").toLowerCase();
}

export function FormerPartnershipsPanel() {
  const [items, setItems] = useState<FormerPartnership[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const response = await apiRequest<{ items: FormerPartnership[] }>(
      "/api/v1/partnerships/former?limit=25",
    );
    setItems(response.items);
  }

  useEffect(() => {
    void load().catch((caught) => setError(errorMessage(caught)));
    const refresh = () => void load().catch(() => undefined);
    window.addEventListener("shawtie:partnership-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("shawtie:partnership-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  async function setBlocked(item: FormerPartnership, blocked: boolean) {
    setBusyId(item.partnershipId);
    setError("");
    try {
      await apiRequest("/api/v1/partnerships/" + item.partnershipId + "/block", {
        method: blocked ? "POST" : "DELETE",
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) return null;

  return (
    <section className="panel">
      <h2>Former partnerships</h2>
      <p className="hint">
        Blocking is private. It prevents discovery, partner requests, and future pairing until you
        remove it.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      <div className="request-list">
        {items.map((item) => (
          <article className="request-card" key={item.partnershipId}>
            <strong>{item.formerPartner?.displayName ?? "Deleted account"}</strong>
            {item.formerPartner ? <p className="muted">@{item.formerPartner.username}</p> : null}
            <p className="hint">
              Ended {new Date(item.terminatedAt).toLocaleString()} through{" "}
              {item.terminationReason === "breakup" ? "breakup" : "partner account deletion"}.
            </p>
            <button
              className={item.blockedByMe ? "secondary compact" : "danger compact"}
              type="button"
              disabled={busyId === item.partnershipId}
              onClick={() => void setBlocked(item, !item.blockedByMe)}
            >
              {item.blockedByMe ? "Unblock" : "Block former partner"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
