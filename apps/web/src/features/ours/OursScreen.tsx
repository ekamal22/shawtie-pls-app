import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./ours.css";
import { Icon } from "../../design/icons.tsx";
import {
  Button,
  Chip,
  EmptyState,
  ErrorNotice,
  Notice,
  PairMark,
  SectionHeading,
  Sheet,
  Skeleton,
  SkeletonGroup,
} from "../../design/primitives.tsx";
import { useM2Runtime } from "../../lib/realtime/runtime-context.tsx";
import {
  listRelationshipItems,
  loadRelationshipHome,
  loadThisDay,
} from "../relationship-space/api.ts";
import type {
  RelationshipItem,
  RelationshipItemKind,
  RelationshipSpaceHome,
} from "../relationship-space/model.ts";
import { RelationshipSpacePanel } from "../relationship-space/RelationshipSpacePanel.tsx";
import {
  bucketItems,
  byOccurrence,
  calendarDateText,
  type Chapter,
  CHAPTER_COPY,
  CHAPTER_KINDS,
  CHAPTERS,
  curate,
  daysUntil,
  durationText,
  isLocked,
  type Lens,
  LENS_LABELS,
  lensKinds,
  newestFirst,
} from "./chapters.ts";
import { oursMessageFor } from "./messages.ts";
import { OursCreateSheet } from "./OursCreateSheet.tsx";
import { OursItemRow, OursItemSheet } from "./OursItems.tsx";

/** Kinds fetched for the chapters. Signals come from the home summary. */
const FETCHED_KINDS: readonly RelationshipItemKind[] = [
  ...CHAPTER_KINDS.then,
  "for_you",
  "love",
  "surprise",
  "proposal",
  "someday",
  "future_us",
  "reunion",
];

const LENSES: readonly Lens[] = ["all", "firsts", "places", "kept"];

interface OursData {
  readonly home: RelationshipSpaceHome;
  readonly items: RelationshipItem[];
  readonly thisDay: RelationshipItem[];
}

async function loadOurs(): Promise<OursData | null> {
  const homeResult = await loadRelationshipHome();
  const home = homeResult.space;
  if (!home) return null;
  const [lists, thisDay] = await Promise.all([
    Promise.all(FETCHED_KINDS.map((kind) => listRelationshipItems({ kind }))),
    loadThisDay(home.serverDate).catch(() => ({ on: home.serverDate, items: [] })),
  ]);
  return {
    home,
    items: [...lists.flatMap((list) => list.items), ...home.recentSignals],
    thisDay: thisDay.items,
  };
}

/**
 * Ours (UX4): the couple's relationship world as one scroll of three chapters. This is a
 * presentation over the existing R1 read APIs and create/patch/release/delete calls. Lifecycle
 * mode and capabilities come from the server home projection and are never re-derived; when
 * the space is view-only the same content is shown without any create or change controls.
 */
export function OursScreen({
  accountId,
  onOpenUs,
}: {
  readonly accountId: string;
  readonly onOpenUs?: () => void;
}) {
  const runtime = useM2Runtime();
  const [data, setData] = useState<OursData | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lens, setLens] = useState<Lens>("all");
  const [listChapter, setListChapter] = useState<Chapter | null>(null);
  const [selected, setSelected] = useState<RelationshipItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const ticket = ++generation.current;
    try {
      const next = await loadOurs();
      if (ticket !== generation.current) return;
      setData(next);
      setError("");
    } catch (caught) {
      if (ticket !== generation.current) return;
      setError(oursMessageFor(caught));
      setData((previous) => (previous === undefined ? null : previous));
    }
  }, []);

  useEffect(() => {
    void reload();
    const refresh = () => void reload();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const events = [
      "shawtie:partnership-changed",
      "shawtie:relationship-changed",
      "shawtie:relationship-queue-changed",
      "focus",
    ] as const;
    for (const name of events) window.addEventListener(name, refresh);
    document.addEventListener("visibilitychange", onVisibility);
    const unregister = runtime.registerSynchronizer("ours-chapters", async () => {
      await reload();
    });
    return () => {
      generation.current += 1;
      for (const name of events) window.removeEventListener(name, refresh);
      document.removeEventListener("visibilitychange", onVisibility);
      unregister();
    };
  }, [reload, runtime]);

  const buckets = useMemo(() => bucketItems(data?.items ?? []), [data]);
  const waiting = useMemo(() => (data ? data.home.upcomingReleases.filter(isLocked) : []), [data]);

  async function afterChange(message?: string) {
    await reload();
    if (message) setNotice(message);
  }

  if (data === undefined) {
    return (
      <SkeletonGroup label="Opening Ours">
        <Skeleton width="55%" />
        <Skeleton shape="block" />
        <Skeleton shape="block" />
      </SkeletonGroup>
    );
  }

  if (data === null) {
    return (
      <div className="ours">
        {error ? (
          <ErrorNotice
            action={
              <Button compact onClick={() => void reload()}>
                Try again
              </Button>
            }
          >
            {error}
          </ErrorNotice>
        ) : (
          <EmptyState
            title="Ours begins with two."
            action={
              onOpenUs ? (
                <Button variant="primary" onClick={onOpenUs}>
                  Go to Us
                </Button>
              ) : undefined
            }
          >
            When you and your person are connected, your story, letters, and plans will live here.
          </EmptyState>
        )}
      </div>
    );
  }

  const { home } = data;
  const viewOnly = home.mode !== "active";
  const canCreate = home.capabilities.create && !viewOnly;
  const modeMessage =
    home.mode === "breakup_pending_view_only"
      ? "Ours is view-only during the breakup process. Letters that were already scheduled may still arrive before the final deadline."
      : home.mode === "account_deletion_view_only"
        ? "Ours is view-only during account recovery. Unreleased letters and reveals are paused."
        : home.mode === "terminated_or_unavailable"
          ? "Ours is not available right now."
          : "";

  const thenItems = buckets.then.filter((item) => lensKinds("then", lens).includes(item.kind));
  const reunion = home.reunion?.featureState?.type === "reunion" ? home.reunion : null;
  const reunionTarget =
    reunion?.featureState?.type === "reunion" ? reunion.featureState.targetDate : null;
  const reunionDays = reunionTarget ? daysUntil(home.serverDate, reunionTarget) : null;
  const nextItems = buckets.next.filter((item) => item.itemId !== reunion?.itemId);
  const nowItems = newestFirst(data.thisDay.filter((item) => !isLocked(item)));
  const nowBucket = buckets.now;

  const chapterItems: Record<Chapter, RelationshipItem[]> = {
    then: thenItems,
    now: nowBucket,
    next: nextItems,
  };

  function listFor(chapter: Chapter): RelationshipItem[] {
    if (chapter === "then") return byOccurrence(thenItems);
    return newestFirst(chapterItems[chapter]);
  }

  return (
    <div className="ours" data-mode={home.mode}>
      <header className="ours-hero">
        <PairMark together size={44} />
        <div>
          <p className="ds-kicker">Together for</p>
          <p className="ours-hero__duration">{durationText(home.relationshipDuration)}</p>
          <p className="ours-hero__since">Since {calendarDateText(home.relationshipStartDate)}</p>
        </div>
        {canCreate ? (
          <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>
            Add to Ours
          </Button>
        ) : null}
      </header>

      {modeMessage ? (
        <div className="ours-viewonly" role="status">
          <Icon name="clock" size={18} />
          <p>{modeMessage}</p>
        </div>
      ) : null}
      {error ? (
        <ErrorNotice
          action={
            <Button compact onClick={() => void reload()}>
              Try again
            </Button>
          }
        >
          {error}
        </ErrorNotice>
      ) : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {CHAPTERS.map((chapter) => {
        const copy = CHAPTER_COPY[chapter];
        const all = chapter === "now" ? nowBucket : chapterItems[chapter];
        const shown = curate(chapter, all);
        const headingId = "ours-chapter-" + chapter;
        const hasExtras =
          (chapter === "now" && (waiting.length > 0 || nowItems.length > 0)) ||
          (chapter === "next" && (reunion !== null || home.anniversary.date));
        const empty = shown.length === 0 && !hasExtras;
        return (
          <section
            key={chapter}
            className="ours-chapter"
            aria-labelledby={headingId}
            data-chapter={chapter}
          >
            <div id={headingId}>
              <SectionHeading kicker={copy.kicker}>{copy.title}</SectionHeading>
            </div>

            {chapter === "then" ? (
              <div className="ours-lenses" role="group" aria-label="Show">
                {LENSES.map((value) => (
                  <Chip key={value} selected={lens === value} onClick={() => setLens(value)}>
                    {LENS_LABELS[value]}
                  </Chip>
                ))}
              </div>
            ) : null}

            {chapter === "now" && waiting.length > 0 ? (
              <div className="ours-block">
                <h3 className="ours-block__title">Waiting for you</h3>
                <ul className="ours-list">
                  {waiting.map((item) => (
                    <OursItemRow key={item.itemId} item={item} onOpen={setSelected} />
                  ))}
                </ul>
              </div>
            ) : null}

            {chapter === "now" && nowItems.length > 0 ? (
              <div className="ours-block">
                <h3 className="ours-block__title">This day in us</h3>
                <ul className="ours-list">
                  {curate("now", nowItems).map((item) => (
                    <OursItemRow key={item.itemId} item={item} onOpen={setSelected} />
                  ))}
                </ul>
              </div>
            ) : null}

            {chapter === "next" && reunion && reunionTarget && reunionDays !== null ? (
              <div className="ours-reunion">
                <p className="ds-kicker">Until we're together again</p>
                <p className="ours-reunion__count">
                  {reunionDays === 0
                    ? "Today"
                    : reunionDays + (reunionDays === 1 ? " day" : " days")}
                </p>
                <p className="ours-hero__since">{calendarDateText(reunionTarget)}</p>
                <Button compact onClick={() => setSelected(reunion)}>
                  Open
                </Button>
              </div>
            ) : null}

            {chapter === "next" && home.anniversary.date ? (
              <p className="ours-anniversary">
                <Icon name="heart" size={18} />
                <span>Our anniversary, {calendarDateText(home.anniversary.date)}</span>
              </p>
            ) : null}

            {shown.length > 0 ? (
              <ul className="ours-list">
                {shown.map((item) => (
                  <OursItemRow key={item.itemId} item={item} onOpen={setSelected} />
                ))}
              </ul>
            ) : null}

            {empty ? (
              <EmptyState
                title={chapter === "then" && lens !== "all" ? "Nothing here just yet." : copy.empty}
                action={
                  canCreate ? (
                    <Button compact onClick={() => setCreateOpen(true)}>
                      Add to Ours
                    </Button>
                  ) : undefined
                }
              >
                {copy.emptyHint}
              </EmptyState>
            ) : null}

            {all.length > shown.length ? (
              <Button variant="quiet" onClick={() => setListChapter(chapter)}>
                See all
              </Button>
            ) : null}

            {chapter === "next" ? (
              <Button variant="quiet" onClick={() => setFullOpen(true)}>
                Our Year and anniversary
              </Button>
            ) : null}
          </section>
        );
      })}

      <div className="ours-footer">
        <Button variant="quiet" onClick={() => setFullOpen(true)}>
          Open the full space
        </Button>
      </div>

      <Sheet
        open={listChapter !== null}
        onClose={() => setListChapter(null)}
        title={listChapter ? CHAPTER_COPY[listChapter].title + ", all" : "All"}
      >
        {listChapter ? (
          <ul className="ours-list">
            {listFor(listChapter).map((item) => (
              <OursItemRow key={item.itemId} item={item} onOpen={setSelected} />
            ))}
          </ul>
        ) : null}
      </Sheet>

      <OursItemSheet
        item={selected}
        accountId={accountId}
        viewOnly={viewOnly}
        onClose={() => setSelected(null)}
        onChanged={afterChange}
      />

      <OursCreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={afterChange}
        onOpenFullEditor={() => {
          setCreateOpen(false);
          setFullOpen(true);
        }}
      />

      <Sheet
        open={fullOpen}
        onClose={() => {
          setFullOpen(false);
          void reload();
        }}
        title="The full space"
      >
        {fullOpen ? <RelationshipSpacePanel accountId={accountId} /> : null}
      </Sheet>
    </div>
  );
}
