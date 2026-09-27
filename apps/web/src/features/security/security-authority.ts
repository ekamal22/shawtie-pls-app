export const STALE_SECURITY_AUTHORITY = "CRYPTO_SECURITY_AUTHORITY_STALE";
const RECENT_REAUTHENTICATION_MS = 10 * 60_000;

export interface SecurityAuthoritySnapshot {
  readonly active: boolean;
  readonly accountScope: string;
  readonly partnershipScope: string;
  readonly revision: number;
}

function staleAuthority(): Error {
  return new Error(STALE_SECURITY_AUTHORITY);
}

export function isStaleSecurityAuthority(error: unknown): boolean {
  return error instanceof Error && error.message === STALE_SECURITY_AUTHORITY;
}

export function hasRecentReauthentication(
  reauthenticatedAt: string | null,
  now = Date.now(),
): boolean {
  if (!reauthenticatedAt) return false;
  const timestamp = Date.parse(reauthenticatedAt);
  return Number.isFinite(timestamp) && now - timestamp <= RECENT_REAUTHENTICATION_MS;
}

export function isCurrentSecurityRefresh(
  ticket: number,
  latestTicket: number,
  active = true,
): boolean {
  return active && ticket === latestTicket;
}

export function assertSecurityAuthorityCurrent(
  captured: SecurityAuthoritySnapshot,
  current: SecurityAuthoritySnapshot,
  includeRevision = true,
): void {
  if (
    !captured.active ||
    !current.active ||
    captured.accountScope !== current.accountScope ||
    captured.partnershipScope !== current.partnershipScope ||
    (includeRevision && captured.revision !== current.revision)
  ) {
    throw staleAuthority();
  }
}

export async function runScopedSecurityMutation<T>({
  captured,
  current,
  mutate,
  reconcile,
  resultIsCurrent,
}: {
  readonly captured: SecurityAuthoritySnapshot;
  readonly current: () => SecurityAuthoritySnapshot;
  readonly mutate: () => Promise<T>;
  readonly reconcile: () => Promise<boolean>;
  readonly resultIsCurrent?: () => boolean;
}): Promise<T> {
  const result = await mutate();

  // Any authority refresh that completed while the mutation was in flight makes
  // its result stale, even if the account and partnership identifiers are equal.
  assertSecurityAuthorityCurrent(captured, current());

  const committed = await reconcile();
  if (!committed) throw staleAuthority();

  // The reconciliation above advances the revision itself, so only stable scope
  // and the action-specific result predicate are checked after it commits.
  assertSecurityAuthorityCurrent(captured, current(), false);
  if (resultIsCurrent && !resultIsCurrent()) throw staleAuthority();

  return result;
}
