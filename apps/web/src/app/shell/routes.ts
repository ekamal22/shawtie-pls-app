import { useCallback, useEffect, useState } from "react";

/**
 * The application has three destinations and one secondary surface:
 * Home (threshold), Talk (conversation), Ours (relationship world), and Us (account,
 * partnership, requests). Routes live in the URL hash so the browser back button works and
 * no server routing or history semantics are involved.
 */
export type Route = "home" | "talk" | "ours" | "us";

export const PRIMARY_ROUTES = ["home", "talk", "ours"] as const;

export const ROUTE_LABELS: Record<Route, string> = {
  home: "Home",
  talk: "Talk",
  ours: "Ours",
  us: "Us",
};

export function parseRoute(hash: string): Route {
  const value = hash.replace(/^#\/?/, "").split("/")[0];
  return value === "talk" || value === "ours" || value === "us" ? value : "home";
}

export function routeHash(route: Route): string {
  return "#/" + route;
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    if (parseRoute(window.location.hash) === next) return;
    window.location.hash = routeHash(next);
  }, []);

  return [route, navigate];
}
