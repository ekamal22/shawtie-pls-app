import { Icon } from "../../design/icons.tsx";
import {
  Avatar,
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

/**
 * Home foundation (UX1). The threshold into the couple's private space: partner identity with
 * authoritative presence context, and two quiet doorways. UX2 owns the richer curated Home
 * (one shared moment, one upcoming element); this proves the shell and design system only.
 */
export function HomeScreen({
  context,
  onNavigate,
}: {
  readonly context: ConversationContext | null | undefined;
  readonly onNavigate: (route: Route) => void;
}) {
  if (context === undefined) {
    return (
      <SkeletonGroup label="Opening your space">
        <Skeleton shape="circle" />
        <Skeleton width="60%" />
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
  return (
    <>
      <section className="home-hero" aria-label="Your partner">
        <Avatar name={name} size={56} />
        <h2 className="home-hero__name">{name}</h2>
        <PresenceLine presence={context.partner.presence} typing={context.partner.typing} />
      </section>
      <div className="home-doors">
        <button type="button" className="home-door" onClick={() => onNavigate("talk")}>
          <div>
            <strong>Talk</strong>
            <span>Pick up where you left off</span>
          </div>
          <Icon name="forward" />
        </button>
        <button type="button" className="home-door" onClick={() => onNavigate("ours")}>
          <div>
            <strong>Ours</strong>
            <span>Then, now, and next</span>
          </div>
          <Icon name="forward" />
        </button>
      </div>
    </>
  );
}
