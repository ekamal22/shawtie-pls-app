import { useEffect, useState } from "react";
import { Button } from "../../design/primitives.tsx";
import { ApiClientError, apiRequest } from "../../lib/api-client.ts";

type NotificationEventType =
  | "partnership_formed"
  | "relationship_start_date_changed"
  | "breakup_started"
  | "breakup_cancelled"
  | "restoration_requested"
  | "partnership_restored"
  | "breakup_deadline_reminder"
  | "partnership_dissolved"
  | "partner_account_deletion_started"
  | "partner_account_recovered"
  | "partner_account_deleted";

interface NotificationItem {
  notificationId: string;
  eventType: NotificationEventType;
  actorAccountId: string | null;
  partnershipId: string | null;
  createdAt: string;
  readAt: string | null;
}

function label(item: NotificationItem): string {
  const labels: Record<NotificationEventType, string> = {
    partnership_formed: "Your partnership is active.",
    relationship_start_date_changed: "Your relationship start date was updated.",
    breakup_started: "The breakup process has started.",
    breakup_cancelled: "The breakup process was cancelled.",
    restoration_requested: "Your partner requested restoration.",
    partnership_restored: "Your partnership was restored.",
    breakup_deadline_reminder: "A reminder about the breakup deadline.",
    partnership_dissolved: "Your partnership reached final dissolution.",
    partner_account_deletion_started: "Your partner requested account deletion.",
    partner_account_recovered: "Your partner recovered their account.",
    partner_account_deleted: "Your partner account was permanently deleted.",
  };
  return labels[item.eventType];
}

export function NotificationsPanel() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const response = await apiRequest<{ items: NotificationItem[] }>(
      "/api/v1/notifications?limit=25",
    );
    setItems(response.items);
  }

  useEffect(() => {
    void load().catch((caught) => {
      setError(caught instanceof ApiClientError ? caught.code : "REQUEST_FAILED");
    });
    const refresh = () => {
      void load().catch(() => undefined);
    };
    window.addEventListener("shawtie:notifications-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("shawtie:notifications-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  async function markRead(notificationId: string) {
    setBusyId(notificationId);
    setError("");
    try {
      await apiRequest("/api/v1/notifications/" + notificationId + "/read", {
        method: "POST",
      });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.code : "REQUEST_FAILED");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="us-block">
      <h2>Notifications</h2>
      {error ? (
        <p className="banner error" role="alert">
          {error.replaceAll("_", " ").toLowerCase()}
        </p>
      ) : null}
      {items.length === 0 ? <p className="muted">No notifications yet.</p> : null}
      <ul className="us-list">
        {items.map((item) => (
          <li className="us-list__item" key={item.notificationId}>
            <strong>{label(item)}</strong>
            <p className="hint">{new Date(item.createdAt).toLocaleString()}</p>
            {!item.readAt ? (
              <div>
                <Button
                  compact
                  disabled={busyId === item.notificationId}
                  onClick={() => void markRead(item.notificationId)}
                >
                  Mark read
                </Button>
              </div>
            ) : (
              <span className="pill">Read</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
