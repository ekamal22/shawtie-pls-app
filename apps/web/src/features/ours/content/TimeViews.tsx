import { useState, type ReactNode } from "react";
import {
  Button,
  EmptyState,
  ErrorNotice,
  Segmented,
  Skeleton,
  SkeletonGroup,
} from "../../../design/primitives.tsx";
import {
  listRelationshipItems,
  loadAnniversary,
  loadOurYear,
  loadThisDay,
} from "../../relationship-space/api.ts";
import { ItemFeedback, ItemMenu, useItemActions } from "./actions.tsx";
import {
  Book,
  CurationPicker,
  initialSelection,
  saveCuration,
  saveReunionPlan,
} from "./curation.tsx";
import { useExperience, useRelationshipItems } from "./data.ts";
import { messageFor } from "./errors.ts";
import { PrintEntry } from "./MemoryViews.tsx";
import {
  formatCalendarDate,
  itemBody,
  itemHeading,
  orderByCurationLinks,
  readString,
  reunionPhrase,
  SOMEDAY_STATES,
  sortByOccurrence,
  yearsAgoPhrase,
  type RelationshipItem,
  type SomedayStateValue,
} from "./model.ts";
import { ListState, ViewHeader } from "./parts.tsx";
import type { ContentViewProps } from "./types.ts";

function todayLocalIso(): string {
  const now = new Date();
  return (
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0")
  );
}

function ExperienceState({
  status,
  error,
  reload,
  children,
}: {
  readonly status: "loading" | "ready" | "error";
  readonly error: string;
  readonly reload: () => Promise<void>;
  readonly children: ReactNode;
}) {
  if (status === "loading") {
    return (
      <SkeletonGroup label="Loading">
        <Skeleton shape="block" />
        <Skeleton width="55%" />
      </SkeletonGroup>
    );
  }
  if (status === "error") {
    return (
      <ErrorNotice
        action={
          <Button compact onClick={() => void reload()}>
            Try again
          </Button>
        }
      >
        {error || "That could not load."}
      </ErrorNotice>
    );
  }
  return <>{children}</>;
}

/**
 * This Day in Us: only the curated eligible items the existing experience endpoint returns.
 * A quiet resurfacing, never a prompt or a streak.
 */
export function ThisDayView(props: ContentViewProps & { readonly on?: string }) {
  const on = props.on ?? todayLocalIso();
  const experience = useExperience(() => loadThisDay(on), [on], Boolean(props.items));
  const items = props.items ?? experience.data?.items ?? [];
  const disabled = props.disabled ?? false;
  const changed = async () => {
    await experience.reload();
    await props.onChanged?.();
  };
  return (
    <section className="mem-view" aria-label="This Day in Us">
      {props.heading !== false ? <ViewHeader kicker="Now" title="This Day in Us" /> : null}
      <ExperienceState {...experience}>
        {items.length === 0 ? (
          <EmptyState title="Nothing from this day yet">
            Some days are simply for today. Memories with a date will find their way here.
          </EmptyState>
        ) : (
          items.map((item) => (
            <div key={item.itemId} className="mem-thisday">
              {yearsAgoPhrase(on, item) ? (
                <p className="mem-lead">{yearsAgoPhrase(on, item)}</p>
              ) : null}
              <PrintEntry
                item={item}
                accountId={props.accountId}
                disabled={disabled}
                onChanged={changed}
                partnerName={props.partnerName}
                onOpenMessage={props.onOpenMessage}
                showKind
              />
            </div>
          ))
        )}
      </ExperienceState>
    </section>
  );
}

/** Our Year as a paged book over the existing candidate recap. No metrics, no rankings. */
export function OurYearView(
  props: ContentViewProps & { readonly year?: number; readonly serverDate?: string },
) {
  const year =
    props.year ??
    (props.serverDate ? Number(props.serverDate.slice(0, 4)) : new Date().getFullYear());
  const experience = useExperience(() => loadOurYear(year), [year], Boolean(props.items));
  const candidates = props.items ?? experience.data?.candidates ?? [];
  const saved = experience.data?.savedCuration ?? null;
  const disabled = props.disabled ?? false;
  const [picking, setPicking] = useState(false);
  const curated = saved && saved.links.some((link) => link.linkType === "curation");
  const pages = curated ? orderByCurationLinks(candidates, saved) : sortByOccurrence(candidates);
  const note = saved ? readString(saved.content, "note") : null;

  return (
    <section className="mem-view" aria-label={"Our Year " + year}>
      {props.heading !== false ? <ViewHeader kicker="Next" title="Our Year" /> : null}
      <ExperienceState {...experience}>
        {candidates.length === 0 ? (
          <EmptyState title={"Your " + year + " book is quiet for now"}>
            Memories with a date from this year gather here, in their own time.
          </EmptyState>
        ) : (
          <Book
            label={"Our Year " + year}
            cover={
              <>
                <p className="ds-kicker">Our Year</p>
                <p className="mem-book__year">{year}</p>
                {note ? <p className="mem-book__note">{note}</p> : null}
              </>
            }
            pages={pages}
            closing="That is the year, as you kept it."
            actions={
              disabled ? null : (
                <div className="mem-book__more">
                  <Button variant="quiet" onClick={() => setPicking(true)}>
                    Choose what belongs in this book
                  </Button>
                </div>
              )
            }
          />
        )}
      </ExperienceState>
      <CurationPicker
        open={picking}
        title="Choose what belongs"
        hint="Select the moments you want to keep in this saved book."
        candidates={candidates}
        initialIds={initialSelection(saved, "curation")}
        checkLabel="Include in curation"
        saveLabel={saved ? "Update curation" : "Save curation"}
        disabled={disabled}
        onClose={() => setPicking(false)}
        onSave={async (ids) => {
          await saveCuration(
            {
              curationType: "our_year",
              anchorYear: year,
              title: "Our Year " + year,
              savedCuration: saved,
            },
            ids,
          );
          await experience.reload();
          await props.onChanged?.();
        }}
      />
    </section>
  );
}

/** Anniversary as a tasteful cover over the existing experience. */
export function AnniversaryView(props: ContentViewProps & { readonly on?: string }) {
  const on = props.on ?? todayLocalIso();
  const experience = useExperience(() => loadAnniversary(on), [on], Boolean(props.items));
  const data = experience.data;
  const candidates = props.items ?? data?.eligibleItems ?? [];
  const saved = data?.savedCuration ?? null;
  const disabled = props.disabled ?? false;
  const [picking, setPicking] = useState(false);
  const curated = saved && saved.links.some((link) => link.linkType === "curation");
  const pages = curated ? orderByCurationLinks(candidates, saved) : sortByOccurrence(candidates);
  const year = Number(on.slice(0, 4));

  return (
    <section className="mem-view" aria-label="Anniversary">
      {props.heading !== false ? <ViewHeader kicker="Next" title="Anniversary" /> : null}
      <ExperienceState {...experience}>
        {!data?.anniversaryDate ? (
          <EmptyState title="Your anniversary will appear here">
            It follows the date you chose for your relationship.
          </EmptyState>
        ) : (
          <Book
            label="Anniversary"
            cover={
              <>
                <p className="ds-kicker">Anniversary</p>
                <p className="mem-book__year">{formatCalendarDate(data.anniversaryDate)}</p>
                {data.relationshipStartDate ? (
                  <p className="mem-book__note">
                    Since {formatCalendarDate(data.relationshipStartDate)}
                  </p>
                ) : null}
              </>
            }
            pages={pages}
            closing="Here is to the next chapter."
            actions={
              disabled ? null : (
                <div className="mem-book__more">
                  <Button variant="quiet" onClick={() => setPicking(true)}>
                    Choose what belongs on this day
                  </Button>
                </div>
              )
            }
          />
        )}
      </ExperienceState>
      <CurationPicker
        open={picking}
        title="Choose what belongs"
        hint="Select the moments you want to keep in this saved curation."
        candidates={candidates}
        initialIds={initialSelection(saved, "curation")}
        checkLabel="Include in curation"
        saveLabel={saved ? "Update curation" : "Save curation"}
        disabled={disabled}
        onClose={() => setPicking(false)}
        onSave={async (ids) => {
          await saveCuration(
            {
              curationType: "anniversary",
              anchorYear: year,
              title: "Anniversary " + (data?.anniversaryDate ?? ""),
              savedCuration: saved,
            },
            ids,
          );
          await experience.reload();
          await props.onChanged?.();
        }}
      />
    </section>
  );
}

function ReunionCard({
  item,
  serverDate,
  props,
  reload,
}: {
  readonly item: RelationshipItem;
  readonly serverDate: string;
  readonly props: ContentViewProps;
  readonly reload: () => Promise<void>;
}) {
  const disabled = props.disabled ?? false;
  const changed = async () => {
    await reload();
    await props.onChanged?.();
  };
  const actions = useItemActions(item, changed);
  const target = item.featureState?.type === "reunion" ? item.featureState.targetDate : "";
  const [draft, setDraft] = useState(target);
  const [planning, setPlanning] = useState(false);
  const [candidates, setCandidates] = useState<RelationshipItem[]>([]);
  const [planError, setPlanError] = useState("");
  const heading = itemHeading(item);
  const note = itemBody(item);

  async function openPlan() {
    setPlanError("");
    try {
      const result = await listRelationshipItems({});
      setCandidates(
        result.items.filter(
          (entry) =>
            entry.itemId !== item.itemId &&
            (entry.release === null || entry.release.state === "released"),
        ),
      );
      setPlanning(true);
    } catch (caught) {
      setPlanError(messageFor(caught));
    }
  }

  return (
    <article className="mem-reunion">
      <div className="mem-reunion__row">
        <p className="ds-kicker">Until we're together again</p>
        <ItemMenu
          item={item}
          accountId={props.accountId}
          disabled={disabled}
          actions={actions}
          allowStory={false}
        />
      </div>
      <p className="mem-reunion__phrase">{reunionPhrase(serverDate, target)}</p>
      <p className="mem-reunion__date">{formatCalendarDate(target)}</p>
      {heading ? <p className="mem-reunion__title">{heading}</p> : null}
      {note ? <p className="mem-reunion__note">{note}</p> : null}
      {!disabled ? (
        <div className="mem-reunion__tools">
          <details className="mem-details">
            <summary>Change the date</summary>
            <div className="mem-inline">
              <label className="mem-field">
                <span>Reunion date</span>
                <input
                  type="date"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </label>
              <Button
                variant="secondary"
                disabled={actions.busy || !draft || draft === target}
                onClick={() => void actions.saveReunionDate(draft)}
              >
                Update date
              </Button>
            </div>
          </details>
          <Button variant="quiet" onClick={() => void openPlan()} disabled={actions.busy}>
            Plan reunion
          </Button>
        </div>
      ) : null}
      {planError ? <ErrorNotice>{planError}</ErrorNotice> : null}
      <ItemFeedback actions={actions} />
      <CurationPicker
        open={planning}
        title="Prepare for the reunion"
        hint="Choose shared moments to prepare for the reunion."
        candidates={candidates}
        initialIds={initialSelection(item, "prepared_content")}
        checkLabel="Prepare for reunion"
        saveLabel="Save reunion plan"
        disabled={disabled}
        onClose={() => setPlanning(false)}
        onSave={async (ids) => {
          await saveReunionPlan(item, ids);
          await changed();
        }}
      />
    </article>
  );
}

/**
 * Until We're Together Again, from the manually entered reunion date. Calm, coarse language
 * (days, weeks, months); no ticking seconds and no countdown clock.
 */
export function ReunionView(props: ContentViewProps & { readonly serverDate?: string }) {
  const state = useRelationshipItems({ kind: "reunion" }, props.items);
  const serverDate = props.serverDate ?? todayLocalIso();
  const reunion = state.items.find((item) => item.featureState?.type === "reunion") ?? null;
  return (
    <section className="mem-view" aria-label="Until we're together again">
      {props.heading !== false ? (
        <ViewHeader kicker="Next" title="Until we're together again" />
      ) : null}
      <ListState
        state={{ ...state, items: reunion ? [reunion] : [] }}
        emptyTitle="No reunion date yet"
        emptyBody="When you know the day you will be together again, add it and it waits here."
        emptyAction={
          props.onAdd && !props.disabled ? (
            <Button variant="primary" onClick={props.onAdd}>
              Add the date
            </Button>
          ) : undefined
        }
      >
        {reunion ? (
          <ReunionCard item={reunion} serverDate={serverDate} props={props} reload={state.reload} />
        ) : null}
      </ListState>
    </section>
  );
}

function SomedayRow({
  item,
  accountId,
  disabled,
  onChanged,
}: {
  readonly item: RelationshipItem;
  readonly accountId: string;
  readonly disabled: boolean;
  readonly onChanged: () => Promise<void>;
}) {
  const actions = useItemActions(item, onChanged);
  const current: SomedayStateValue =
    item.featureState?.type === "someday" ? item.featureState.state : "someday";
  const heading = itemHeading(item);
  const note = readString(item.content, "note");
  return (
    <li className="mem-someday" data-state={current}>
      <div className="mem-someday__row">
        <h4 className="mem-someday__title">{heading ?? "Someday"}</h4>
        <ItemMenu item={item} accountId={accountId} disabled={disabled} actions={actions} />
      </div>
      {note ? <p className="mem-someday__note">{note}</p> : null}
      {disabled ? (
        <p className="mem-hint">{SOMEDAY_STATES.find((entry) => entry.value === current)?.label}</p>
      ) : (
        <Segmented
          label={"Where this is now: " + (heading ?? "Someday")}
          value={current}
          options={SOMEDAY_STATES}
          onChange={(next) => {
            if (next !== current && !actions.busy) void actions.setSomedayState(next);
          }}
        />
      )}
      <ItemFeedback actions={actions} />
    </li>
  );
}

/**
 * Someday, with three soft states over the existing shared state change: Someday, Soon, and
 * We did it. Either partner may change the state (R1 feature table); the server decides.
 */
export function SomedayView(props: ContentViewProps) {
  const state = useRelationshipItems({ kind: "someday" }, props.items);
  const disabled = props.disabled ?? false;
  const changed = async () => {
    await state.reload();
    await props.onChanged?.();
  };
  const groups = SOMEDAY_STATES.map((entry) => ({
    ...entry,
    items: state.items.filter(
      (item) => item.featureState?.type === "someday" && item.featureState.state === entry.value,
    ),
  })).filter((group) => group.items.length > 0);
  return (
    <section className="mem-view" aria-label="Someday">
      {props.heading !== false ? <ViewHeader kicker="Next" title="Someday" /> : null}
      <ListState
        state={state}
        emptyTitle="Room for someday"
        emptyBody="Places to go, things to try, a slow plan for later."
        emptyAction={
          props.onAdd && !disabled ? (
            <Button variant="primary" onClick={props.onAdd}>
              Add a someday
            </Button>
          ) : undefined
        }
      >
        {groups.map((group) => (
          <div key={group.value} className="mem-someday-group">
            <h3 className="mem-someday-group__label">{group.label}</h3>
            <ul className="mem-someday-list">
              {group.items.map((item) => (
                <SomedayRow
                  key={item.itemId}
                  item={item}
                  accountId={props.accountId}
                  disabled={disabled}
                  onChanged={changed}
                />
              ))}
            </ul>
          </div>
        ))}
      </ListState>
    </section>
  );
}
