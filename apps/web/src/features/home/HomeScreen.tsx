import { Icon } from "../../design/icons.tsx";
import {
  Avatar,
  Card,
  EmptyState,
  PresenceLine,
  Skeleton,
  SkeletonGroup,
} from "../../design/primitives.tsx";
import type { Route } from "../../app/shell/routes.ts";
import {
  type ConversationContext,
  partnerDisplayName,
} from "../../app/shell/useConversationContext.ts";
import "./home.css";
import {
  type HomeMoment,
  type LatestPreview,
  daysPhrase,
  formatCalendarDate,
  formatMessageWhen,
} from "./home-model.ts";
import { useHomeData } from "./useHomeData.ts";

/**
 * Home, the threshold into the couple's private space (UX2). Curated, not a dashboard:
 * partner identity with authoritative presence context, one obvious path into Talk (with the
 * latest message when the app already has it), at most one quiet shared moment, and a
 * restrained doorway into Ours. Read-only: viewing Home never marks anything read and never
 * writes anything. Presence, last seen, and typing are mutual and always on.
 */
export function HomeScreen({
  context,
  accountId,
  onNavigate,
}: {
  readonly context: ConversationContext | null | undefined;
  readonly accountId: string;
  readonly onNavigate: (route: Route) => void;
}) {
  const data = useHomeData(accountId, context ? context.partnershipId : null);

  if (context === undefined) {
    return (
      <SkeletonGroup label="Opening your space">
        <div className="home-loading">
          <Skeleton shape="circle" />
          <Skeleton width="55%" />
          <Skeleton width="35%" />
        </div>
        <Skeleton shape="block" />
        <Skeleton shape="block" />
      </SkeletonGroup>
    );
  }

  if (context === null) {
    return (
      <EmptyState
        title="Your space is waiting for two."
        action={
          <button
            type="button"
            className="ds-button ds-button--primary"
            onClick={() => onNavigate("us")}
          >
            Find your person
          </button>
        }
      >
        Once you are connected, this is where the two of you will meet.
      </EmptyState>
    );
  }

  const name = partnerDisplayName(context);
  const viewOnly = context.interactionMode !== "normal";
  return (
    <div className="home-page">
      <section className="home-presence" aria-label="Your partner">
        <Avatar name={name} size={72} />
        <h2 className="home-presence__name">{name}</h2>
        <PresenceLine presence={context.partner.presence} typing={context.partner.typing} />
      </section>

      <button type="button" className="home-talk" onClick={() => onNavigate("talk")}>
        <span className="home-talk__body">
          <strong className="home-talk__title">Talk</strong>
          <TalkLine latest={data.latest} name={name} viewOnly={viewOnly} />
        </span>
        <Icon name="forward" />
      </button>

      <MomentCard moment={data.moment} />

      <button type="button" className="home-ours" onClick={() => onNavigate("ours")}>
        <span className="home-ours__body">
          <strong className="home-ours__title">Ours</strong>
          <span className="home-ours__line">Then, now, and next</span>
        </span>
        <Icon name="forward" />
      </button>
    </div>
  );
}

function TalkLine({
  latest,
  name,
  viewOnly,
}: {
  readonly latest: LatestPreview | null | undefined;
  readonly name: string;
  readonly viewOnly: boolean;
}) {
  if (latest === undefined) {
    return (
      <span className="home-talk__line" aria-hidden="true">
        <Skeleton width="70%" />
      </span>
    );
  }
  if (latest === null) {
    return (
      <span className="home-talk__line">
        {viewOnly ? "Your conversation" : "Say hello, or pick up where you left off."}
      </span>
    );
  }
  return (
    <>
      <span className="home-talk__line home-talk__snippet">
        <span className="home-talk__who">{latest.fromMe ? "You" : name}</span>
        {": "}
        {latest.text}
      </span>
      <span className="home-talk__when">{formatMessageWhen(latest.createdAt)}</span>
    </>
  );
}

function MomentCard({ moment }: { readonly moment: HomeMoment | null | undefined }) {
  if (moment === null) return null;
  if (moment === undefined) {
    return (
      <div className="home-moment-loading" aria-hidden="true">
        <Skeleton shape="block" />
      </div>
    );
  }
  return (
    <Card as="article" surface="paper" className="home-moment" aria-label="A quiet moment">
      {moment.type === "reunion" ? (
        <>
          <p className="home-moment__kicker">Until we&rsquo;re together again</p>
          <p className="home-moment__figure">{daysPhrase(moment.days)}</p>
          <p className="home-moment__note">{formatCalendarDate(moment.date)}</p>
        </>
      ) : null}
      {moment.type === "anniversary" ? (
        <>
          <p className="home-moment__kicker">Our anniversary</p>
          <p className="home-moment__figure">
            {moment.days === 0 ? "Today" : "In " + daysPhrase(moment.days)}
          </p>
          <p className="home-moment__note">{formatCalendarDate(moment.date)}</p>
        </>
      ) : null}
      {moment.type === "this_day" ? (
        <>
          <p className="home-moment__kicker">This day</p>
          <p className="home-moment__quote">{moment.title}</p>
        </>
      ) : null}
      {moment.type === "recent" ? (
        <>
          <p className="home-moment__kicker">Lately</p>
          <p className="home-moment__quote">{moment.title}</p>
        </>
      ) : null}
    </Card>
  );
}
