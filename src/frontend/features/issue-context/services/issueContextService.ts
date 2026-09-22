import { view } from '@forge/bridge';
import { getErrorMessage } from '../../../shared/errors';
import { callResolver } from '../../../shared/resolverClient';
import { isLinkStatus, type LinkStatus } from '../../../shared/status';
import { toContentType, type ContentType } from '../../../shared/contentType';
import type { ExcerptMatch, IssuePanelData, LinkedPage, SearchContentResult } from '../types';

/**
 * Bridge layer for the Jira issue context panel: every resolver call and every bit of response
 * normalisation lives here, so the hook only deals with already-clean data.
 */

interface ExtensionIssueContext {
  extension?: {
    issue?: {
      key?: string;
    };
  };
}

/** Mirrors `IssuePanelView` in `backend/types/contracts.ts`. */
interface IssuePanelViewResponse {
  truncated?: boolean;
  links?: Array<{
    id: string;
    contentId: string;
    status: string;
    linkedAt?: number;
    updatedAt?: number;
    title?: string;
    spaceKey?: string;
    spaceName?: string;
    contentType?: string;
    webUrl?: string;
  }>;
}

/** Mirrors the return of `searchConfluenceContent` in `backend/services/confluenceService.ts`. */
interface SearchResponse {
  results?: unknown;
  nextCursor?: string | null;
  resolvedFromLink?: boolean;
}

export interface SearchContentPage {
  results: SearchContentResult[];
  nextCursor: string | null;
  resolvedFromLink: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const toLinkStatus = (status: unknown): LinkStatus => {
  return typeof status === 'string' && isLinkStatus(status) ? status : 'not_started';
};

const toNullableNumber = (value: unknown): number | null => {
  return typeof value === 'number' ? value : null;
};

const toText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Relative fallback used whenever Confluence did not give us a usable web URL. */
const toFallbackPageUrl = (contentId: string): string => `/wiki/pages/viewpage.action?pageId=${contentId}`;

/**
 * Keeps only ranges that actually fall inside the excerpt.
 *
 * The highlight offsets are computed on the backend while stripping markers; a malformed or
 * truncated excerpt would otherwise produce a range that slices past the end of the string and
 * renders a stray empty fragment.
 */
const toExcerptMatches = (value: unknown, excerptLength: number): ExcerptMatch[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((match) => ({ start: Number(match.start), end: Number(match.end) }))
    .filter(
      (match) =>
        Number.isInteger(match.start) &&
        Number.isInteger(match.end) &&
        match.start >= 0 &&
        match.end > match.start &&
        match.end <= excerptLength
    );
};

const toSearchResult = (raw: unknown): SearchContentResult | null => {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) {
    return null;
  }

  const excerpt = toText(raw.excerpt);

  return {
    id: raw.id,
    title: toText(raw.title) || `Content ${raw.id}`,
    spaceKey: toText(raw.spaceKey),
    spaceName: toText(raw.spaceName),
    contentType: toContentType(raw.contentType),
    webUrl: toText(raw.webUrl) || toFallbackPageUrl(raw.id),
    excerpt,
    excerptMatches: toExcerptMatches(raw.excerptMatches, excerpt.length),
    breadcrumb: toText(raw.breadcrumb),
    lastModified: toText(raw.lastModified)
  };
};

export const getIssueKeyFromContext = async (): Promise<string | null> => {
  const contextValue = (await view.getContext()) as ExtensionIssueContext;
  const issueKey = contextValue.extension?.issue?.key;
  return issueKey ? String(issueKey) : null;
};

/**
 * Runs one page of the Confluence search.
 *
 * An empty `query` is valid and intentional: the backend answers it with recently edited
 * content, which is what the picker shows before the user types anything.
 */
export const searchConfluenceContent = async (
  query: string,
  types: ContentType[],
  cursor?: string
): Promise<SearchContentPage> => {
  const response = await callResolver<SearchResponse>('searchConfluenceContent', {
    query,
    types,
    ...(cursor ? { cursor } : {})
  });

  const rawResults = Array.isArray(response.results) ? response.results : [];

  return {
    results: rawResults
      .map(toSearchResult)
      .filter((result): result is SearchContentResult => result !== null),
    nextCursor: typeof response.nextCursor === 'string' && response.nextCursor ? response.nextCursor : null,
    resolvedFromLink: response.resolvedFromLink === true
  };
};

/**
 * Loads the pages linked to an issue in a single resolver call.
 *
 * The resolver already fetches each page to decide whether this user may see it, so the titles,
 * spaces and URLs come back from that same lookup instead of a second round trip.
 */
export const getIssuePanelData = async (issueKey: string): Promise<IssuePanelData> => {
  const response = await callResolver<IssuePanelViewResponse>('getIssuePanelView', { issueKey });
  const rawLinks = Array.isArray(response.links) ? response.links : [];

  return {
    truncated: response.truncated === true,
    linkedPages: rawLinks.map((link): LinkedPage => ({
      id: link.id,
      contentId: link.contentId,
      issueKey,
      title: link.title || `Content ${link.contentId}`,
      spaceKey: link.spaceKey || '-',
      spaceName: link.spaceName || '',
      contentType: toContentType(link.contentType),
      status: toLinkStatus(link.status),
      webUrl: link.webUrl || toFallbackPageUrl(link.contentId),
      linkedAt: toNullableNumber(link.linkedAt),
      updatedAt: toNullableNumber(link.updatedAt)
    }))
  };
};

/**
 * The content type is deliberately not sent: the resolver reads it from Confluence itself, so a
 * caller cannot mislabel a page as something else.
 */
export const linkContentToTicket = async (contentId: string, issueKey: string): Promise<void> => {
  await callResolver('linkContentToTicket', { contentId, issueKey });
};

export const unlinkContentFromTicket = async (contentId: string, issueKey: string): Promise<void> => {
  await callResolver('unlinkContentFromTicket', { contentId, issueKey });
};

/**
 * Builds the optimistic row shown immediately after linking, before the next reload replaces it
 * with server data.
 */export const toLinkedPageFromSearch = (result: SearchContentResult, issueKey: string): LinkedPage => ({
  id: result.id,
  contentId: result.id,
  issueKey,
  title: result.title,
  spaceKey: result.spaceKey,
  spaceName: result.spaceName,
  contentType: result.contentType,
  status: 'not_started',
  webUrl: result.webUrl || toFallbackPageUrl(result.id),
  linkedAt: Date.now(),
  updatedAt: null
});

export const toSearchError = (error: unknown): string => {
  return `We could not search Confluence right now. (${getErrorMessage(error)})`;
};

export const toLoadError = (error: unknown): string => `Could not load linked resources (${getErrorMessage(error)})`;

export const toLinkError = (error: unknown): string => `Could not link that resource: ${getErrorMessage(error)}`;

export const toUnlinkError = (error: unknown): string => `Could not unlink that resource: ${getErrorMessage(error)}`;

/** Shown when an issue has more links than one read can return. */
export const truncationWarning = (shown: number): string =>
  `Showing the ${shown} most recently updated resources. This issue has more links than can be displayed at once.`;
