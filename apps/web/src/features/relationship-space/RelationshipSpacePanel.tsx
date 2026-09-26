import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Button,
  Chip,
  ErrorNotice,
  LifecycleBanner,
  Notice,
  Sheet,
  Skeleton,
  SkeletonGroup,
} from "../../design/primitives.tsx";
import { useM2Runtime } from "../../lib/realtime/runtime-context.tsx";
import { listRelationshipItems, loadRelationshipHome } from "./api.ts";
import type { RelationshipItemKind, RelationshipSpaceHome } from "./model.ts";
import {
  AnniversaryView,
  FirstsView,
  ForYouView,
  FutureUsView,
  KeptView,
  LoveView,
  MemoriesView,
  PlacesView,
  ProposalView,
  RecentView,
  RelationshipComposer,
  ReunionView,
  SignalsView,
  SomedayView,
  StoryView,
  SurpriseView,
  ThisDayView,
  OurYearView,
  VoiceLettersView,
  WaitingView,
  formatCalendarDate,
  reunionPhrase,
  togetherPhrase,
} from "../ours/content/index.ts";
import { messageFor } from "../ours/content/errors.ts";

/*
 * Relationship Space, presented as Ours content. This panel keeps its props and its data
 * duties (home projection, offline cache, synchronizer, refresh signals) and composes the
 * per-kind views from features/ours/content. The Then/Now/Next chapters (UX4) can import the
 * same views directly.
 */

type Lens =
  | "recent"
  | "story"
  | "kept"
  | "memories"
  | "firsts"
  | "places"
  | "for_you"
  | "voice"
  | "love"
  | "signals"
  | "this_day"
  | "future_us"
  | "someday"
  | "reunion"
  | "our_year"
  | "anniversary"
  | "surprise"
  | "proposal";

const LENSES: ReadonlyArray<{ value: Lens; label: string; create: RelationshipItemKind }> = [
  { value: "recent", label: "Recent", create: "memory" },
  { value: "story", label: "Our Story", create: "memory" },
  { value: "kept", label: "Kept", create: "remember_this" },
  { value: "memories", label: "Memories", create: "memory" },
  { value: "firsts", label: "Firsts", create: "first" },
  { value: "places", label: "Places", create: "place" },
  { value: "for_you", label: "For you", create: "for_you" },
  { value: "voice", label: "Voice Letters", create: "for_you" },
  { value: "love", label: "Love", create: "love" },
  { value: "signals", label: "Signals", create: "relationship_signal" },
  { value: "this_day", label: "This Day", create: "memory" },
  { value: "future_us", label: "Future Us", create: "future_us" },
  { value: "someday", label: "Someday", create: "someday" },
  { value: "reunion", label: "Reunion", create: "reunion" },
  { value: "our_year", label: "Our Year", create: "memory" },
  { value: "anniversary", label: "Anniversary", create: "memory" },
  { value: "surprise", label: "Surprise", create: "surprise" },
  { value: "proposal", label: "Proposal", create: "proposal" },
];

export function RelationshipSpacePanel({ accountId }: { accountId: string }) {
  const runtime = useM2Runtime();
  const [home, setHome] = useState<RelationshipSpaceHome | null | undefined>(undefined);
  const [lens, setLens] = useState<Lens>("recent");
  const [composerOpen, setComposerOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const viewOnly = home ? home.mode !== "active" : true;

  async function load() {
    const [homeResult, itemResult] = await Promise.all([
      loadRelationshipHome(),
      listRelationshipItems({}),
    ]);
    setHome(homeResult.space);

    const partnershipId = runtime.realtime.scope.partnershipId;
    if (partnershipId && homeResult.space) {
      await (await runtime.database()).cacheRelationshipItems(partnershipId, itemResult.items);
    }
  }

  useEffect(() => {
    void load().catch((caught) => setError(messageFor(caught)));
  }, []);

  useEffect(
    () =>
      runtime.registerSynchronizer("relationship-space", async () => {
        await load();
      }),
    [runtime],
  );

  useEffect(() => {
    const refresh = () => void load().catch(() => undefined);
    const resetAndRefresh = () => {
      setHome(undefined);
      setNotice("");
      setError("");
      void load().catch((caught) => setError(messageFor(caught)));
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    const queued = () => {
      setNotice("Relationship change queued. It will sync when authority allows.");
      if (navigator.onLine) refresh();
    };
    window.addEventListener("shawtie:partnership-changed", resetAndRefresh);
    window.addEventListener("shawtie:relationship-changed", refresh);
    window.addEventListener("shawtie:relationship-queue-changed", queued);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("shawtie:partnership-changed", resetAndRefresh);
      window.removeEventListener("shawtie:relationship-changed", refresh);
      window.removeEventListener("shawtie:relationship-queue-changed", queued);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const modeMessage = useMemo(() => {
    if (!home) return null;
    if (home.mode === "breakup_pending_view_only") {
      return {
        title: "Ours is view-only for now",
        body: "Relationship Space is view-only during the breakup process. Existing scheduled letters may still arrive before the final deadline.",
      };
    }
    if (home.mode === "account_deletion_view_only") {
      return {
        title: "Ours is view-only for now",
        body: "Relationship Space is view-only during account recovery. Unreleased letters and reveals are paused.",
      };
    }
    return null;
  }, [home]);

  async function refresh(message?: string) {
    await load();
    if (message) setNotice(message);
  }

  if (home === undefined) {
    return (
      <section className="mem-space" aria-label="Ours">
        <SkeletonGroup label="Loading your shared space">
          <Skeleton shape="block" />
          <Skeleton width="70%" />
          <Skeleton width="45%" />
        </SkeletonGroup>
        {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      </section>
    );
  }

  if (!home) {
    return null;
  }

  const active =
    LENSES.find((entry) => entry.value === lens) ?? (LENSES[0] as (typeof LENSES)[number]);
  const common = {
    accountId,
    disabled: viewOnly,
    onChanged: () => refresh(),
    onAdd: viewOnly ? undefined : () => setComposerOpen(true),
  };

  let content: ReactNode;
  switch (lens) {
    case "story":
      content = <StoryView {...common} heading={false} />;
      break;
    case "kept":
      content = <KeptView {...common} heading={false} />;
      break;
    case "memories":
      content = <MemoriesView {...common} heading={false} />;
      break;
    case "firsts":
      content = <FirstsView {...common} heading={false} />;
      break;
    case "places":
      content = <PlacesView {...common} heading={false} />;
      break;
    case "for_you":
      content = <ForYouView {...common} heading={false} />;
      break;
    case "voice":
      content = <VoiceLettersView {...common} heading={false} />;
      break;
    case "love":
      content = <LoveView {...common} heading={false} />;
      break;
    case "signals":
      content = <SignalsView {...common} heading={false} />;
      break;
    case "this_day":
      content = <ThisDayView {...common} heading={false} on={home.serverDate} />;
      break;
    case "future_us":
      content = <FutureUsView {...common} heading={false} />;
      break;
    case "someday":
      content = <SomedayView {...common} heading={false} />;
      break;
    case "reunion":
      content = <ReunionView {...common} heading={false} serverDate={home.serverDate} />;
      break;
    case "our_year":
      content = <OurYearView {...common} heading={false} serverDate={home.serverDate} />;
      break;
    case "anniversary":
      content = <AnniversaryView {...common} heading={false} on={home.serverDate} />;
      break;
    case "surprise":
      content = <SurpriseView {...common} heading={false} />;
      break;
    case "proposal":
      content = <ProposalView {...common} heading={false} />;
      break;
    default:
      content = <RecentView {...common} heading={false} />;
  }

  return (
    <section className="mem-space" aria-label="Ours">
      <header className="mem-hero">
        <p className="ds-kicker">Us</p>
        <h2 className="mem-hero__title">
          Together for {togetherPhrase(home.relationshipDuration)}
        </h2>
        <p className="mem-hero__meta">
          Since {formatCalendarDate(home.relationshipStartDate)}. Your anniversary is{" "}
          {formatCalendarDate(home.anniversary.date)}.
        </p>
        {home.reunion?.featureState?.type === "reunion" ? (
          <button type="button" className="mem-hero__reunion" onClick={() => setLens("reunion")}>
            <span className="ds-kicker">Until we're together again</span>
            <span className="mem-hero__phrase">
              {reunionPhrase(home.serverDate, home.reunion.featureState.targetDate)}
            </span>
          </button>
        ) : null}
      </header>

      {modeMessage ? (
        <LifecycleBanner title={modeMessage.title}>{modeMessage.body}</LifecycleBanner>
      ) : null}
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <WaitingView
        accountId={accountId}
        disabled={viewOnly}
        items={home.upcomingReleases}
        onChanged={() => refresh()}
      />

      <nav className="mem-lenses" aria-label="Relationship Space">
        <div className="mem-lenses__strip">
          {LENSES.map((entry) => (
            <Chip
              key={entry.value}
              selected={lens === entry.value}
              onClick={() => setLens(entry.value)}
            >
              {entry.label}
            </Chip>
          ))}
        </div>
      </nav>

      <div className="mem-lens-actions">
        <Button
          variant="primary"
          icon="plus"
          disabled={!home.capabilities.create}
          onClick={() => setComposerOpen(true)}
        >
          Add to Ours
        </Button>
      </div>

      <div className="mem-lens-body" data-lens={lens}>
        {content}
      </div>

      <Sheet open={composerOpen} onClose={() => setComposerOpen(false)} title="Add to Ours">
        {composerOpen ? (
          <RelationshipComposer
            accountId={accountId}
            partnershipId={runtime.realtime.scope.partnershipId}
            disabled={!home.capabilities.create}
            initialKind={active.create}
            onCreated={async () => {
              setComposerOpen(false);
              await refresh("Added to Ours.");
            }}
          />
        ) : null}
      </Sheet>
    </section>
  );
}
