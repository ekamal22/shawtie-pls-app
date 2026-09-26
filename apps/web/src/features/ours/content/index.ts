import "./mem.css";

/*
 * Ours content views (UX6). Each view takes `ContentViewProps`: pass already fetched `items`
 * for a purely presentational view, or omit them and the view fetches through the existing
 * relationship-space api.ts functions. Pass `heading={false}` when the page supplies its own.
 */
export type { ContentViewProps } from "./types.ts";
export {
  StoryView,
  MemoriesView,
  KeptView,
  FirstsView,
  PlacesView,
  LoveView,
} from "./MemoryViews.tsx";
export { ForYouView, FutureUsView, VoiceLettersView } from "./LetterViews.tsx";
export { SurpriseView, ProposalView, SignalsView } from "./MomentViews.tsx";
export {
  ThisDayView,
  OurYearView,
  AnniversaryView,
  ReunionView,
  SomedayView,
} from "./TimeViews.tsx";
export { RecentView, WaitingView, ItemByKind } from "./RecentView.tsx";
export { RelationshipComposer, COMPOSER_GROUPS } from "./Composer.tsx";
export { resolveMessageSource, openSourceMessage } from "./source.ts";
export {
  describeOccurrence,
  groupStoryByYear,
  reunionPhrase,
  sealInfo,
  togetherPhrase,
  formatCalendarDate,
} from "./model.ts";
