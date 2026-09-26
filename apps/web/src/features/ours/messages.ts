import { ApiClientError } from "../../lib/api-client.ts";

/**
 * Plain, recoverable wording for the existing relationship-space error codes. Meaning matches
 * the legacy panel's map; the server codes and their handling are unchanged.
 */
export function oursMessageFor(error: unknown): string {
  if (!(error instanceof ApiClientError)) return "Something went wrong.";
  const known: Record<string, string> = {
    AUTH_REQUIRED: "Please sign in again.",
    OFFLINE_OPERATION_REQUIRES_CONNECTION:
      "This relationship action requires an internet connection.",
    CURATION_ALREADY_EXISTS: "That curation already exists. Refresh and edit the saved version.",
    IDEMPOTENCY_KEY_REUSED: "That action changed. Try again.",
    INVALID_ITEM_LINK: "One selected relationship item is no longer available.",
    INVALID_OCCURRENCE: "Check the date and try again.",
    INVALID_REFERENCE: "That attachment or source is not available here.",
    ITEM_ALREADY_RELEASED: "This has already been opened.",
    ITEM_IMMUTABLE_AFTER_RELEASE: "Opened content cannot be edited.",
    NO_CURRENT_PARTNERSHIP: "There is no current relationship space.",
    REFERENCE_TYPE_UNAVAILABLE: "That attachment type is not available yet.",
    RELATIONSHIP_ITEM_IMMUTABLE: "This item can no longer be edited.",
    RELATIONSHIP_ITEM_NOT_FOUND: "That relationship item is no longer available.",
    RELATIONSHIP_ITEM_NOT_OWNED: "Only the person who created this can change it.",
    RELATIONSHIP_SHARED_STATE_NOT_ALLOWED: "That shared state cannot be changed.",
    RELATIONSHIP_SPACE_VIEW_ONLY: "Ours is currently view-only.",
    RELEASE_NOT_ALLOWED: "This item cannot be opened from this account.",
    RELEASE_TIME_INVALID: "Choose a future release time.",
    REUNION_DATE_INVALID: "Choose today or a future reunion date.",
    UNSUPPORTED_CONTENT_SCHEMA_VERSION: "This relationship item needs a newer app version.",
    VERSION_CONFLICT: "This changed on another device. Refresh and try again.",
  };
  return known[error.code] ?? error.code.replaceAll("_", " ").toLowerCase();
}

export function queuedMutation(value: unknown): boolean {
  return value !== null && typeof value === "object" && "queued" in value && value.queued === true;
}
