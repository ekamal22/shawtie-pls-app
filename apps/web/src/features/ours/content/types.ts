import type { RelationshipItem } from "../../relationship-space/model.ts";

/**
 * Props shared by every Ours content view. A view either receives already fetched `items`
 * (purely presentational, nothing is requested) or fetches through the existing
 * relationship-space api.ts functions.
 */
export interface ContentViewProps {
  readonly accountId: string;
  /** True when the space is view-only (breakup pending, account deletion, or unavailable). */
  readonly disabled?: boolean | undefined;
  readonly items?: readonly RelationshipItem[] | undefined;
  /** Called after a successful mutation or reload so a parent can refresh its own state. */
  readonly onChanged?: (() => void | Promise<void>) | undefined;
  /** Shows the view's own heading. Pages that supply their own heading pass false. */
  readonly heading?: boolean | undefined;
  /** Partner's display name when the caller knows it. Used only for wording. */
  readonly partnerName?: string | undefined;
  /** Empty states offer this action when provided and the space is writable. */
  readonly onAdd?: (() => void) | undefined;
  /** Overrides Memory Return navigation. Defaults to opening Talk on the source message. */
  readonly onOpenMessage?: ((messageId: string) => void) | undefined;
}
