import { type ReactNode, useEffect, useRef } from "react";
import { Icon, type IconName } from "../../design/icons.tsx";
import { PairMark } from "../../design/primitives.tsx";
import { PRIMARY_ROUTES, ROUTE_LABELS, type Route } from "./routes.ts";
import { useKeyboardOpen } from "./useKeyboardOpen.ts";

const NAV_ICONS: Record<(typeof PRIMARY_ROUTES)[number], IconName> = {
  home: "home",
  talk: "talk",
  ours: "ours",
};

export interface AppShellProps {
  readonly route: Route;
  readonly onNavigate: (route: Route) => void;
  /** Persistent, route-independent status region (sync, queue, lifecycle). */
  readonly status?: ReactNode;
  /** Always mounted, visible on every route (incoming and active calls). */
  readonly calls?: ReactNode;
  /**
   * Whether the partner is online per the existing always-on presence contract. Presentation
   * only: it draws the Pair Mark together and is never shown as a number or a streak.
   */
  readonly partnerOnline?: boolean;
  readonly children: ReactNode;
}

/**
 * Mobile-first application shell: header with the pair mark (opens Us), the active route's
 * content, and a bottom navigation with Home, Talk, and Ours. On wide screens the same
 * navigation becomes a left rail. Route content is provided by the caller so that panels with
 * background responsibilities (heartbeat, receipts, call signaling) stay mounted.
 */
export function AppShell({
  route,
  onNavigate,
  status,
  calls,
  partnerOnline = false,
  children,
}: AppShellProps) {
  const keyboardOpen = useKeyboardOpen();
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to the route content after navigation so keyboard and screen-reader users land
  // in the new place, without scrolling past the header.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [route]);

  return (
    <div className="app-shell" data-route={route} data-keyboard={keyboardOpen ? "open" : "closed"}>
      <header className="app-header">
        <button
          type="button"
          className="app-header__identity"
          aria-label="Us: account and partnership"
          aria-current={route === "us" ? "page" : undefined}
          data-together={route === "ours" || partnerOnline ? "true" : "false"}
          onClick={() => onNavigate("us")}
        >
          <PairMark together={route === "ours" || partnerOnline} />
        </button>
        <h1 className="app-header__title">
          {route === "home" ? "Shawtie pls" : ROUTE_LABELS[route]}
        </h1>
      </header>

      <main
        className="app-main"
        id="main"
        tabIndex={-1}
        ref={mainRef}
        aria-label={ROUTE_LABELS[route]}
      >
        <div className="app-stack">
          {status}
          {calls}
          {children}
        </div>
      </main>

      <nav className="app-nav" aria-label="Primary">
        <ul className="app-nav__list">
          {PRIMARY_ROUTES.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="app-nav__link"
                style={{ width: "100%" }}
                aria-current={route === name ? "page" : undefined}
                onClick={() => onNavigate(name)}
              >
                <Icon name={NAV_ICONS[name]} filled={route === name} />
                {ROUTE_LABELS[name]}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/**
 * Renders one route's content. Inactive routes are either not rendered (`keepMounted` false)
 * or kept mounted but removed from view and the accessibility tree (`hidden`, which also
 * makes the subtree inert). Kept-mounted routes preserve M1/M2 background duties.
 */
export function RouteView({
  active,
  keepMounted = false,
  children,
}: {
  readonly active: boolean;
  readonly keepMounted?: boolean;
  readonly children: ReactNode;
}) {
  if (!active && !keepMounted) return null;
  return (
    <div className={"app-route app-stack" + (active ? " is-entering" : "")} hidden={!active}>
      {children}
    </div>
  );
}
