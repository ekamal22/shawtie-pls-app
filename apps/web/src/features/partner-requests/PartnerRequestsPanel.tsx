import { type FormEvent, useEffect, useState } from "react";
import { ApiClientError, apiRequest } from "../../lib/api-client.ts";

interface DiscoveryResult {
  accountId: string;
  username: string;
  displayName: string;
  age: number;
  bio: string | null;
}

interface RequestItem {
  requestId: string;
  direction: "incoming" | "outgoing";
  counterpart: {
    accountId: string;
    username: string;
    displayName: string;
    age: number;
    bio: string | null;
  };
  relationshipStartDate: string;
  createdAt: string;
  expiresAt: string;
}

interface RequestPage {
  items: RequestItem[];
  nextCursor: string | null;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return "Something went wrong.";
  const known: Record<string, string> = {
    IDEMPOTENCY_KEY_REUSED: "This send attempt changed. Please try again.",
    RATE_LIMITED: "Too many attempts. Try again later.",
    RELATIONSHIP_DATE_FUTURE: "The relationship start date cannot be in the future.",
    REQUEST_ALREADY_PENDING: "You already have a pending request to this person.",
    REQUEST_DECLINE_COOLDOWN: "You need to wait before sending this person another request.",
    REQUEST_MONTHLY_LIMIT: "You reached the monthly request limit for this person.",
    TARGET_CHANGED: "That username changed. Search again before sending.",
    TARGET_UNAVAILABLE: "That person is not available for a partner request.",
  };
  return known[error.code] ?? error.code.replaceAll("_", " ").toLowerCase();
}

function requestLabel(item: RequestItem): string {
  return item.direction === "incoming" ? "From" : "To";
}

export function PartnerRequestsPanel() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [relationshipStartDate, setRelationshipStartDate] = useState("");
  const [incoming, setIncoming] = useState<RequestItem[]>([]);
  const [outgoing, setOutgoing] = useState<RequestItem[]>([]);
  const [incomingCursor, setIncomingCursor] = useState<string | null>(null);
  const [outgoingCursor, setOutgoingCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function page(
    direction: "incoming" | "outgoing",
    cursor?: string,
  ): Promise<RequestPage> {
    const search = new URLSearchParams({ direction, limit: "25" });
    if (cursor) search.set("cursor", cursor);
    return apiRequest<RequestPage>("/api/v1/partner-requests?" + search.toString());
  }

  async function refreshLists() {
    const [incomingPage, outgoingPage] = await Promise.all([
      page("incoming"),
      page("outgoing"),
    ]);
    setIncoming(incomingPage.items);
    setOutgoing(outgoingPage.items);
    setIncomingCursor(incomingPage.nextCursor);
    setOutgoingCursor(outgoingPage.nextCursor);
  }

  useEffect(() => {
    void refreshLists().catch(() => undefined);
    const onFocus = () => {
      void refreshLists().catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const response = await apiRequest<{ result: DiscoveryResult | null }>(
        "/api/v1/discovery/username",
        { method: "POST", body: { username: query } },
      );
      setResult(response.result);
      if (!response.result) setNotice("No matching available profile.");
    });
  }

  async function sendRequest() {
    if (!result || !relationshipStartDate) return;
    await run(async () => {
      const response = await apiRequest<{ outcome: string }>(
        "/api/v1/partner-requests",
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: {
            recipientAccountId: result.accountId,
            expectedUsername: result.username,
            relationshipStartDate,
          },
        },
      );
      setNotice(
        response.outcome === "reciprocal_pair_ready"
          ? "Both requests are ready to pair once partnership formation is enabled."
          : "Partner request sent.",
      );
      setResult(null);
      setQuery("");
      setRelationshipStartDate("");
      await refreshLists();
    });
  }

  async function mutate(requestId: string, action: "cancel" | "decline") {
    await run(async () => {
      await apiRequest("/api/v1/partner-requests/" + requestId + "/" + action, {
        method: "POST",
      });
      setNotice(action === "cancel" ? "Request cancelled." : "Request declined.");
      await refreshLists();
    });
  }

  async function loadMore(direction: "incoming" | "outgoing") {
    const cursor = direction === "incoming" ? incomingCursor : outgoingCursor;
    if (!cursor) return;
    await run(async () => {
      const next = await page(direction, cursor);
      if (direction === "incoming") {
        setIncoming((current) => [...current, ...next.items]);
        setIncomingCursor(next.nextCursor);
      } else {
        setOutgoing((current) => [...current, ...next.items]);
        setOutgoingCursor(next.nextCursor);
      }
    });
  }

  return (
    <section className="panel">
      <h2>Find your partner</h2>
      <p className="hint">Search an exact username. Private account details are never shown.</p>
      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner success">{notice}</p> : null}

      <form className="stack" onSubmit={search}>
        <label className="field">
          <span>Username</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <button className="secondary" disabled={busy}>Search</button>
      </form>

      {result ? (
        <article className="profile-card">
          <div>
            <strong>{result.displayName}</strong>
            <p className="muted">@{result.username} · age {result.age}</p>
            {result.bio ? <p>{result.bio}</p> : null}
          </div>
          <label className="field">
            <span>Relationship start date</span>
            <input
              type="date"
              value={relationshipStartDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setRelationshipStartDate(event.target.value)}
              required
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={busy || !relationshipStartDate}
            onClick={() => void sendRequest()}
          >
            Send partner request
          </button>
        </article>
      ) : null}

      <div className="partner-grid">
        <div>
          <h3>Incoming</h3>
          <div className="request-list">
            {incoming.length === 0 ? <p className="muted">No incoming requests.</p> : null}
            {incoming.map((item) => (
              <article className="request-card" key={item.requestId}>
                <strong>{item.counterpart.displayName}</strong>
                <p className="muted">
                  {requestLabel(item)} @{item.counterpart.username} · relationship since{" "}
                  {item.relationshipStartDate}
                </p>
                <p className="hint">Expires {new Date(item.expiresAt).toLocaleString()}</p>
                <button
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => void mutate(item.requestId, "decline")}
                >
                  Decline
                </button>
              </article>
            ))}
          </div>
          {incomingCursor ? (
            <button
              className="link"
              disabled={busy}
              onClick={() => void loadMore("incoming")}
            >
              Load more incoming
            </button>
          ) : null}
        </div>

        <div>
          <h3>Outgoing</h3>
          <div className="request-list">
            {outgoing.length === 0 ? <p className="muted">No outgoing requests.</p> : null}
            {outgoing.map((item) => (
              <article className="request-card" key={item.requestId}>
                <strong>{item.counterpart.displayName}</strong>
                <p className="muted">
                  {requestLabel(item)} @{item.counterpart.username} · relationship since{" "}
                  {item.relationshipStartDate}
                </p>
                <p className="hint">Expires {new Date(item.expiresAt).toLocaleString()}</p>
                <button
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => void mutate(item.requestId, "cancel")}
                >
                  Cancel
                </button>
              </article>
            ))}
          </div>
          {outgoingCursor ? (
            <button
              className="link"
              disabled={busy}
              onClick={() => void loadMore("outgoing")}
            >
              Load more outgoing
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
