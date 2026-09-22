import type { LinkStatus } from '../../../shared/status';

export interface ContentLink {
  id: string;
  contentId: string;
  issueKey: string;
  issueTypeName: string;
  issueTypeIconUrl: string;
  status: LinkStatus;
  summary: string;
  linkedAt: number | null;
  updatedAt: number | null;
  transitionVersion: number | null;
}

export interface LinkTransitionHistoryItem {
  id: string;
  contentId: string;
  issueKey: string;
  status: LinkStatus;
  transitionVersion: number;
  /** `null` when the transition predates user tracking or was made by the app itself. */
  transitionedByAccountId: string | null;
  transitionedAt: number;
}

/**
 * Everything the view needs to build absolute Confluence/Jira URLs. Derived from the Forge
 * context at runtime rather than hardcoded, so the app works on any site.
 */
export interface PageContext {
  siteUrl: string;
  pageTitle: string;
  pageSpaceKey: string;
}

/**
 * Everything the byline panel needs, as returned by a single `getBylineView` call.
 */
export interface BylineData {
  links: ContentLink[];
  /** True when the page has more links than one read can return. */
  truncated: boolean;
  pageTitle: string;
  pageSpaceKey: string;
}

export interface BylineItemViewModel {
  links: ContentLink[];
  pageContext: PageContext;
  isLoading: boolean;
  isUpdating: boolean;
  error: string | null;
  /** Non-blocking notice shown when the link list was cut short. */
  warning: string | null;
  openStatusMenuLinkId: string | null;
  selectedDetailsLinkId: string | null;
  historyItems: LinkTransitionHistoryItem[];
  historyLoading: boolean;
  historyError: string | null;
  openMenuForLink: (id: string) => void;
  openDetailsForLink: (id: string) => void;
  closePopup: () => void;
  goBackToTable: () => void;
  onUpdateStatus: (issueKey: string, contentId: string, status: LinkStatus) => Promise<void>;
}
