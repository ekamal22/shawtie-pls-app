import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../../design/primitives.tsx";
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
    PARTNERSHIP_OCCUPIED: "You already have an active partnership.",
    COOLDOWN_ACTIVE: "You are not eligible to form another partnership yet.",
    REQUEST_SELF: "You cannot send a partner request to yourself.",
    REQUEST_ALREADY_PENDING: "You already have a pending request to this person.",
    REQUEST_DECLINE_COOLDOWN: "You need to wait before sending this person another request.",
    REQUEST_MONTHLY_LIMIT: "You reached the monthly request limit for this person.",
    TARGET_CHANGED: "That username changed. Search again before sending.",
    TARGET_UNAVAILABLE: "That person is not available for a partner request.",
    REQUEST_NOT_AVAILABLE: "That request is no longer available.",
    PARTNERSHIP_UNAVAILABLE: "A partnership could not be formed.",
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
  const [sendAttemptKey, setSendAttemptKey] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<RequestItem[]>([]);
  const [outgoing, setOutgoing] = useState<RequestItem[]>([]);
  const [incomingCursor, setIncomingCursor] = useState<string | null>(null);
  const [outgoingCursor, setOutgoingCursor] = useState<string | null>(null);
  const [partnershipOccupied, setPartnershipOccupied] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function page(direction: "incoming" | "outgoing", cursor?: string): Promise<RequestPage> {
    const search = new URLSearchParams({ direction, limit: "25" });
    if (cursor) search.set("cursor", cursor);
    return apiRequest<RequestPage>("/api/v1/partner-requests?" + search.toString());
  }

  async function refreshLists() {
    const [incomingPage, outgoingPage] = await Promise.all([page("incoming"), page("outgoing")]);
    setIncoming(incomingPage.items);
    setOutgoing(outgoingPage.items);
    setIncomingCursor(incomingPage.nextCursor);
    setOutgoingCursor(outgoingPage.nextCursor);
  }

  useEffect(() => {
    async function refreshAvailability() {
      const current = await apiRequest<{ partnership: unknown | null }>(
        "/api/v1/partnerships/current",
      );
      setPartnershipOccupied(Boolean(current.partnership));
      if (!current.partnership) {
        await refreshLists();
      } else {
        setIncoming([]);
        setOutgoing([]);
        setIncomingCursor(null);
        setOutgoingCursor(null);
        setResult(null);
      }
    }

    void refreshAvailability().catch(() => undefined);
    const onFocus = () => {
      void refreshAvailability().catch(() => undefined);
    };
    const onMode = (event: Event) => {
      const custom = event as CustomEvent<{ occupied?: boolean }>;
      if (typeof custom.detail?.occupied === "boolean") {
        setPartnershipOccupied(custom.detail.occupied);
        if (custom.detail.occupied) {
          setResult(null);
          setIncoming([]);
          setOutgoing([]);
        } else {
          void refreshLists().catch(() => undefined);
        }
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("shawtie:partnership-changed", onFocus);
    window.addEventListener("shawtie:partnership-mode", onMode);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("shawtie:partnership-changed", onFocus);
      window.removeEventListener("shawtie:partnership-mode", onMode);
    };
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
      setSendAttemptKey(null);
      if (!response.result) setNotice("No matching available profile.");
    });
  }

  async function sendRequest() {
    if (!result || !relationshipStartDate) return;
    await run(async () => {
      const idempotencyKey = sendAttemptKey ?? crypto.randomUUID();
      if (!sendAttemptKey) setSendAttemptKey(idempotencyKey);
      try {
        const response = await apiRequest<{ outcome: string }>("/api/v1/partner-requests", {
          method: "POST",
          headers: { "idempotency-key": idempotencyKey },
          body: {
            recipientAccountId: result.accountId,
            expectedUsername: result.username,
            relationshipStartDate,
          },
        });
        setSendAttemptKey(null);
        setNotice(
          response.outcome === "paired"
            ? "Your partnership is active."
            : response.outcome === "reciprocal_pair_ready"
              ? "Both requests are ready to pair."
              : "Partner request sent.",
        );
        if (response.outcome === "paired") {
          window.dispatchEvent(new Event("shawtie:partnership-changed"));
          window.dispatchEvent(new Event("shawtie:notifications-changed"));
        }
        setResult(null);
        setQuery("");
        setRelationshipStartDate("");
        await refreshLists();
      } catch (caught) {
        if (caught instanceof ApiClientError) {
          setSendAttemptKey(null);
        }
        throw caught;
      }
    });
  }

  async function acceptRequest(requestId: string) {
    await run(async () => {
      await apiRequest("/api/v1/partner-requests/" + requestId + "/accept", {
        method: "POST",
      });
      setNotice("Your partnership is active.");
      await refreshLists();
      window.dispatchEvent(new Event("shawtie:partnership-changed"));
      window.dispatchEvent(new Event("shawtie:notifications-changed"));
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

  if (partnershipOccupied === undefined) {
    return (
      <section className="us-block">
        <h2>Find your partner</h2>
        <p className="muted">Checking partnership availability...</p>
      </section>
    );
  }

  if (partnershipOccupied) {
    return (
      <section className="us-block">
        <h2>Partner requests</h2>
        <p className="hint">
          New discovery, requests, and acceptance are unavailable while this partnership occupies
          your partner slot.
        </p>
      </section>
    );
  }

  const requestList = (
    direction: "incoming" | "outgoing",
    items: RequestItem[],
    cursor: string | null,
  ) => (
    <div className="stack">
      <h3>{direction === "incoming" ? "Incoming" : "Outgoing"}</h3>
      {items.length === 0 ? (
        <p className="muted">No {direction === "incoming" ? "incoming" : "outgoing"} requests.</p>
      ) : (
        <ul className="us-list">
          {items.map((item) => (
            <li className="us-list__item" key={item.requestId}>
              <strong>{item.counterpart.displayName}</strong>
              <p className="muted">
                {requestLabel(item)} @{item.counterpart.username} · relationship since{" "}
                {item.relationshipStartDate}
              </p>
              <p className="hint">Expires {new Date(item.expiresAt).toLocaleString()}</p>
              <div className="ours-actions">
                {direction === "incoming" ? (
                  <>
                    <Button
                      variant="primary"
                      compact
                      disabled={busy}
                      onClick={() => void acceptRequest(item.requestId)}
                    >
                      Accept
                    </Button>
                    <Button
                      compact
                      disabled={busy}
                      onClick={() => void mutate(item.requestId, "decline")}
                    >
                      Decline
                    </Button>
                  </>
                ) : (
                  <Button
                    compact
                    disabled={busy}
                    onClick={() => void mutate(item.requestId, "cancel")}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <div>
          <Button variant="quiet" compact disabled={busy} onClick={() => void loadMore(direction)}>
            Load more {direction}
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="us-block">
      <h2>Find your partner</h2>
      <p className="hint">Search an exact username. Private account details are never shown.</p>
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
        <div>
          <Button type="submit" disabled={busy}>
            Search
          </Button>
        </div>
      </form>

      {result ? (
        <div className="us-list__item">
          <div>
            <strong>{result.displayName}</strong>
            <p className="muted">
              @{result.username} · age {result.age}
            </p>
            {result.bio ? <p>{result.bio}</p> : null}
          </div>
          <label className="field">
            <span>Relationship start date</span>
            <input
              type="date"
              value={relationshipStartDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => {
                setRelationshipStartDate(event.target.value);
                setSendAttemptKey(null);
              }}
              required
            />
          </label>
          <div>
            <Button
              variant="primary"
              disabled={busy || !relationshipStartDate}
              onClick={() => void sendRequest()}
            >
              Send partner request
            </Button>
          </div>
        </div>
      ) : null}

      {requestList("incoming", incoming, incomingCursor)}
      {requestList("outgoing", outgoing, outgoingCursor)}
    </section>
  );
}
