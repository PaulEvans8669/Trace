// The workflow itself lives in `src/shared/linkStatus.ts` so that the resolver and the UI Kit
// frontend cannot drift apart. Re-exported here to keep existing backend imports working.
import type { LinkStatus } from '../../shared/linkStatus';

export type { LinkStatus };
export { VALID_LINK_STATUSES, isValidTransition } from '../../shared/linkStatus';

export interface LinkContentPayload {
  contentId: string;
  contentType?: string;
  issueKey: string;
}

export interface UnlinkContentPayload {
  contentId: string;
  issueKey: string;
}

export interface UpdateLinkStatusPayload {
  contentId: string;
  issueKey: string;
  newStatus: LinkStatus;
}

export interface LinkTransitionHistoryPayload {
  contentId: string;
  issueKey: string;
}

export interface ContentPayload {
  contentId: string;
}

export interface TicketPayload {
  issueKey: string;
}

export interface SearchPayload {
  query?: string;
  /** Restricts results to these content types. Defaults to every supported type. */
  types?: string[];
  spaceKeys?: string[];
  /** Opaque cursor from a previous response, for "load more". */
  cursor?: string;
}

/**
 * View models returned by the two aggregate read endpoints.
 *
 * These endpoints are shaped around what a panel renders rather than around database tables.
 * That matters for more than tidiness: the permission check has to fetch the page and the
 * issues anyway, so returning that data costs nothing extra. An earlier CRUD-shaped surface
 * fetched it, threw it away, and let the frontend request it all over again.
 */
export interface BylineLinkView {
  id: string;
  contentId: string;
  issueKey: string;
  status: LinkStatus;
  linkedAt: number;
  updatedAt: number;
  transitionVersion: number | null;
  transitionAt: number | null;
  /** Jira metadata, resolved during the same call that authorised the read. */
  summary: string;
  issueTypeName: string;
  /** A base64 data URL - issue-type icons sit behind auth and cannot be loaded by URL. */
  issueTypeIconUrl: string;
}

export interface BylineView {
  page: {
    id: string;
    title: string;
    spaceKey: string;
    spaceName: string;
    webUrl: string;
  };
  links: BylineLinkView[];
  /** True when more links exist than the read limit allows us to return. */
  truncated: boolean;
}

export interface IssuePanelLinkView {
  id: string;
  contentId: string;
  contentType: string;
  status: LinkStatus;
  linkedAt: number;
  updatedAt: number;
  /** Confluence metadata, resolved during the same call that authorised the read. */
  title: string;
  spaceKey: string;
  spaceName: string;
  webUrl: string;
}

export interface IssuePanelView {
  links: IssuePanelLinkView[];
  truncated: boolean;
}

export interface LinkTransitionResponse {
  status: LinkStatus;
  confluenceVersion: number;
  transitionedAt: number;
  /** `null` when the transition was recorded without an identifiable user. */
  transitionedByAccountId: string | null;
}
