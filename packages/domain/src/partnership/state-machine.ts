import type {
  MemberId,
  PartnershipState,
  TransitionResult,
} from "./types.ts";
import { addCalendarMonthsUtc, addDays, addHours, isAtOrAfter, isBefore } from "./time.ts";

function memberExists(state: PartnershipState, memberId: MemberId): boolean {
  return state.members.includes(memberId);
}

function otherMember(state: PartnershipState, memberId: MemberId): MemberId {
  const [a, b] = state.members;
  return a === memberId ? b : a;
}

export function initiateBreakup(
  state: PartnershipState,
  actorId: MemberId,
  now: string,
): TransitionResult<PartnershipState> {
  if (!memberExists(state, actorId) || state.lifecycle !== "active" || state.accountDeletion) {
    return { ok: false, reason: "BREAKUP_REQUIRED" };
  }

  const nextGeneration = state.generation + 1;
  return {
    ok: true,
    state: {
      ...state,
      lifecycle: "breakup_pending",
      generation: nextGeneration,
      breakup: {
        initiatedBy: actorId,
        initiatedAt: now,
        initiatorCancelUntil: addHours(now, 1),
        baseDeadline: addDays(now, 7),
        finalDeadline: addDays(now, 7),
        restoreIntentAt: {},
        generation: nextGeneration,
      },
    },
  };
}

export function cancelBreakup(
  state: PartnershipState,
  actorId: MemberId,
  now: string,
): TransitionResult<PartnershipState> {
  const breakup = state.breakup;
  if (state.accountDeletion) {
    return { ok: false, reason: "ACCOUNT_LOCKED" };
  }
  if (state.lifecycle !== "breakup_pending" || !breakup) {
    return { ok: false, reason: "BREAKUP_REQUIRED" };
  }
  if (breakup.initiatedBy !== actorId) {
    return { ok: false, reason: "NOT_BREAKUP_INITIATOR" };
  }
  if (!isBefore(now, breakup.initiatorCancelUntil)) {
    return { ok: false, reason: "BREAKUP_WINDOW_EXPIRED" };
  }

  return {
    ok: true,
    state: {
      ...state,
      lifecycle: "active",
      generation: state.generation + 1,
      breakup: null,
    },
  };
}

export function submitRestoreIntent(
  state: PartnershipState,
  actorId: MemberId,
  now: string,
): TransitionResult<PartnershipState> {
  const breakup = state.breakup;
  if (state.accountDeletion) {
    return { ok: false, reason: "ACCOUNT_LOCKED" };
  }
  if (state.lifecycle !== "breakup_pending" || !breakup || !memberExists(state, actorId)) {
    return { ok: false, reason: "BREAKUP_REQUIRED" };
  }
  if (isAtOrAfter(now, breakup.finalDeadline)) {
    return { ok: false, reason: "BREAKUP_DEADLINE_EXPIRED" };
  }
  if (breakup.restoreIntentAt[actorId]) {
    return { ok: false, reason: "RESTORE_INTENT_ALREADY_SUBMITTED" };
  }

  const otherId = otherMember(state, actorId);
  const updatedIntents = { ...breakup.restoreIntentAt, [actorId]: now };

  if (updatedIntents[otherId]) {
    return {
      ok: true,
      state: {
        ...state,
        lifecycle: "active",
        generation: state.generation + 1,
        breakup: null,
      },
    };
  }

  const nextGeneration = state.generation + 1;
  return {
    ok: true,
    state: {
      ...state,
      generation: nextGeneration,
      breakup: {
        ...breakup,
        restoreIntentAt: updatedIntents,
        finalDeadline: addDays(breakup.initiatedAt, 10),
        generation: nextGeneration,
      },
    },
  };
}

export function finalizeBreakup(
  state: PartnershipState,
  now: string,
  expectedGeneration: number,
): TransitionResult<PartnershipState> {
  const breakup = state.breakup;
  if (state.lifecycle !== "breakup_pending" || !breakup) {
    return { ok: false, reason: "BREAKUP_REQUIRED" };
  }
  if (expectedGeneration !== breakup.generation) {
    return { ok: false, reason: "STALE_GENERATION" };
  }
  if (!isAtOrAfter(now, breakup.finalDeadline)) {
    return { ok: false, reason: "TOO_EARLY" };
  }

  const dissolvedAt = breakup.finalDeadline;
  const eligibleAt = addCalendarMonthsUtc(dissolvedAt, 3);
  const [a, b] = state.members;

  return {
    ok: true,
    state: {
      ...state,
      lifecycle: "terminated",
      generation: state.generation + 1,
      breakup: { ...breakup },
      terminatedAt: dissolvedAt,
      terminationReason: "breakup",
      partnerEligibleAt: {
        ...state.partnerEligibleAt,
        [a]: eligibleAt,
        [b]: eligibleAt,
      },
    },
  };
}

export function requestAccountDeletion(
  state: PartnershipState,
  actorId: MemberId,
  now: string,
): TransitionResult<PartnershipState> {
  if (!memberExists(state, actorId) || state.lifecycle === "terminated" || state.accountDeletion) {
    return { ok: false, reason: "ACCOUNT_LOCKED" };
  }

  const nextGeneration = state.generation + 1;
  return {
    ok: true,
    state: {
      ...state,
      generation: nextGeneration,
      accountDeletion: {
        accountId: actorId,
        requestedAt: now,
        recoverUntil: addDays(now, 7),
        generation: nextGeneration,
      },
    },
  };
}

export function recoverDeletedAccount(
  state: PartnershipState,
  actorId: MemberId,
  now: string,
): TransitionResult<PartnershipState> {
  const deletion = state.accountDeletion;
  if (!deletion || deletion.accountId !== actorId) {
    return { ok: false, reason: "ACCOUNT_LOCKED" };
  }
  if (isAtOrAfter(now, deletion.recoverUntil)) {
    return { ok: false, reason: "BREAKUP_DEADLINE_EXPIRED" };
  }

  return {
    ok: true,
    state: {
      ...state,
      generation: state.generation + 1,
      accountDeletion: null,
    },
  };
}

export function finalizeAccountDeletion(
  state: PartnershipState,
  now: string,
  expectedGeneration: number,
): TransitionResult<PartnershipState> {
  const deletion = state.accountDeletion;
  if (!deletion) {
    return { ok: false, reason: "ACCOUNT_LOCKED" };
  }
  if (expectedGeneration !== deletion.generation) {
    return { ok: false, reason: "STALE_GENERATION" };
  }
  if (!isAtOrAfter(now, deletion.recoverUntil)) {
    return { ok: false, reason: "TOO_EARLY" };
  }
  if (state.breakup && isAtOrAfter(now, state.breakup.finalDeadline)) {
    return { ok: false, reason: "BREAKUP_DEADLINE_EXPIRED" };
  }

  const remainingMember = otherMember(state, deletion.accountId);
  return {
    ok: true,
    state: {
      ...state,
      lifecycle: "terminated",
      generation: state.generation + 1,
      accountDeletion: null,
      terminatedAt: deletion.recoverUntil,
      terminationReason: "partner_account_deleted",
      partnerEligibleAt: {
        ...state.partnerEligibleAt,
        [remainingMember]: addCalendarMonthsUtc(deletion.recoverUntil, 1),
      },
    },
  };
}
