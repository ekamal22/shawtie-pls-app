import { useEffect, useState } from "react";
import { ApiClientError, apiRequest } from "../../lib/api-client.ts";

interface NotificationItem {
  notificationId: string;
  eventType: "partnership_formed" | "relationship_start_date_changed";
  actorAccountId: string | null;
  partnershipId: string | null;
  createdAt: string;
  readAt: string | null;
}

function label(item: NotificationItem): string {
  if (item.eventType === "partnership_formed") {
    return "Your partnership is active.";
  }
  return "Your relationship start date was updated.";
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
      await apiRequest(`/api/v1/notifications/${notificationId}/read`, {
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
    <section className="panel">
      <h2>Notifications</h2>
      {error ? <p className="banner error">{error.replaceAll("_", " ").toLowerCase()}</p> : null}
      <div className="request-list">
        {items.length === 0 ? <p className="muted">No notifications yet.</p> : null}
        {items.map((item) => (
          <article className="request-card" key={item.notificationId}>
            <strong>{label(item)}</strong>
            <p className="hint">{new Date(item.createdAt).toLocaleString()}</p>
            {!item.readAt ? (
              <button
                className="secondary compact"
                type="button"
                disabled={busyId === item.notificationId}
                onClick={() => void markRead(item.notificationId)}
              >
                Mark read
              </button>
            ) : (
              <span className="pill">Read</span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
