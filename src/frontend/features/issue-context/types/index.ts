import type { LinkStatus } from '../../../shared/status';
import type { ContentType } from '../../../shared/contentType';

/** A half-open `[start, end)` range into `excerpt`, marking one matched search term. */
export interface ExcerptMatch {
  start: number;
  end: number;
}

/**
 * One row in the picker.
 *
 * Everything beyond `id`/`title` exists to let a user recognise the right result without
 * opening it: the type icon, where it lives, when it last changed, and the snippet of body
 * text that actually matched.
 */
export interface SearchContentResult {
  id: string;
  title: string;
  spaceKey: string;
  spaceName: string;
  contentType: ContentType;
  webUrl: string;
  /** Plain-text snippet around the match, with Confluence's highlight markers already removed. */
  excerpt: string;
  excerptMatches: ExcerptMatch[];
  /** "ENG > Platform > Security" - the ancestor trail, falling back to the space name. */
  breadcrumb: string;
  /** Confluence's own phrasing, e.g. "3 days ago". Empty when it gave us nothing. */
  lastModified: string;
}

export interface LinkedPage {
  id: string;
  contentId: string;
  issueKey: string;
  title: string;
  spaceKey: string;
  spaceName: string;
  contentType: ContentType;
  status: LinkStatus;
  webUrl: string;
  linkedAt: number | null;
  updatedAt: number | null;
}

/**
 * What the picker is currently showing.
 *
 * `error` and "no results" are deliberately separate: an empty list after a successful search
 * is a normal, informative outcome, while a failure needs to say so and invite a retry.
 */
export interface SearchState {
  loading: boolean;
  /** True while a "Load more" request is in flight, so the existing rows stay put. */
  loadingMore: boolean;
  error: string;
  results: SearchContentResult[];
  /** Opaque Confluence cursor for the next page; null when the list is complete. */
  nextCursor: string | null;
  /** True once a search has run, so the empty state can tell "nothing yet" from "no matches". */
  hasSearched: boolean;
  /** True when the query was a pasted Confluence link resolved directly to one result. */
  resolvedFromLink: boolean;
  /** True when showing recently edited content rather than query matches. */
  isRecent: boolean;
}

/**
 * Everything the issue panel needs, as returned by a single `getIssuePanelView` call.
 */
export interface IssuePanelData {
  linkedPages: LinkedPage[];
  /** True when the issue has more links than one read can return. */
  truncated: boolean;
}

export interface IssueContextViewModel {
  isLoadingLinks: boolean;
  isUpdating: boolean;
  linkedPages: LinkedPage[];
  /** Errors from loading, linking or unlinking. Search errors live in `searchState`. */
  error: string | null;
  /** Non-blocking notice shown when the link list was cut short. */
  warning: string | null;
  searchState: SearchState;
  /** The raw text in the search box. */
  query: string;
  /** True while the link dialog is open. Nothing is searched while it is closed. */
  isPickerOpen: boolean;
  /** Content ids already linked to this issue, so their rows can be shown as such. */
  linkedContentIds: string[];
  /** The id currently being linked, so only that row shows a pending state. */
  pendingContentId: string | null;
  onQueryChange: (value: string) => void;
  onOpenPicker: () => void;
  onClosePicker: () => void;
  onSelectResult: (result: SearchContentResult) => Promise<void>;
  onLoadMore: () => Promise<void>;
  onRemovePage: (pageId: string, contentId: string, issueKey: string) => Promise<void>;
}
