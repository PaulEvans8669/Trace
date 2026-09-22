import { view } from '@forge/bridge';
import { getErrorMessage } from '../../../shared/errors';
import { callResolver } from '../../../shared/resolverClient';
import { isLinkStatus, type LinkStatus } from '../../../shared/status';
import type { BylineData, ContentLink, LinkTransitionHistoryItem, PageContext } from '../types';

/**
 * Bridge layer for the Confluence byline panel: every resolver call and every bit of response
 * normalisation lives here, so the hook only deals with already-clean data.
 */

interface ExtensionContentContext {
  siteUrl?: string;
  extension?: {
    content?: {
      id?: string | number;
    };
  };
}

/** Mirrors `BylineView` in `backend/types/contracts.ts`. */
interface BylineViewResponse {
  page?: {
    title?: string;
    spaceKey?: string;
  };
  truncated?: boolean;
  links?: Array<{
    id: string;
    contentId: string;
    issueKey: string;
    status: string;
    linkedAt?: number;
    updatedAt?: number;
    transitionVersion?: number | null;
    summary?: string;
    issueTypeName?: string;
    issueTypeIconUrl?: string;
  }>;
}

interface UpdateLinkStatusResponse {
  transition?: {
    confluenceVersion?: number;
    transitionedAt?: number;
  };
}

interface LinkTransitionHistoryResponse {
  history?: Array<{
    id: string;
    contentId: string;
    issueKey: string;
    status: string;
    transitionVersion: number;
    transitionedAt: number;
    transitionedByAccountId: string | null;
  }>;
}

const toStatus = (status: string): LinkStatus => (isLinkStatus(status) ? status : 'not_started');
const toNullableNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/**
 * Reads the content id and the site URL out of the Forge context.
 *
 * The site URL matters: history and profile links must be absolute, and hardcoding a hostname
 * would break the app on every site but one.
 */
export const getBylineContext = async (): Promise<{ contentId: string | null; siteUrl: string }> => {
  const contextValue = (await view.getContext()) as ExtensionContentContext;
  const contentId = contextValue.extension?.content?.id;

  return {
    contentId: contentId !== undefined && contentId !== null ? String(contentId) : null,
    // Trailing slashes would produce '//wiki/...' once concatenated.
    siteUrl: (contextValue.siteUrl || '').replace(/\/+$/, '')
  };
};

/**
 * Loads everything the panel renders in a single resolver call.
 *
 * The resolver has to fetch the page and the issues anyway in order to decide what this user is
 * allowed to see, so it returns that data rather than making us ask for it again.
 */
export const getBylineData = async (contentId: string): Promise<BylineData> => {
  const response = await callResolver<BylineViewResponse>('getBylineView', { contentId });
  const rawLinks = Array.isArray(response.links) ? response.links : [];

  const links = rawLinks.map((link): ContentLink => ({
    id: link.id,
    contentId: link.contentId || contentId,
    issueKey: link.issueKey,
    issueTypeName: link.issueTypeName || 'Issue',
    issueTypeIconUrl: link.issueTypeIconUrl || '',
    status: toStatus(link.status),
    summary: link.summary || link.issueKey,
    linkedAt: toNullableNumber(link.linkedAt) ?? toNullableNumber(link.updatedAt),
    updatedAt: toNullableNumber(link.updatedAt),
    transitionVersion: toNullableNumber(link.transitionVersion)
  }));

  return {
    links,
    truncated: response.truncated === true,
    pageTitle: response.page?.title || '',
    pageSpaceKey: response.page?.spaceKey || ''
  };
};

export const updateLinkStatus = async (
  contentId: string,
  issueKey: string,
  status: LinkStatus
): Promise<{ transitionVersion: number; updatedAt: number }> => {
  const response = await callResolver<UpdateLinkStatusResponse>('updateLinkStatus', {
    contentId,
    issueKey,
    newStatus: status
  });

  const transitionVersion = response.transition?.confluenceVersion;
  const updatedAt = response.transition?.transitionedAt;
  if (typeof transitionVersion !== 'number' || typeof updatedAt !== 'number') {
    throw new Error('Invalid transition response payload');
  }

  return { transitionVersion, updatedAt };
};

export const getLinkTransitionHistory = async (
  contentId: string,
  issueKey: string
): Promise<LinkTransitionHistoryItem[]> => {
  const response = await callResolver<LinkTransitionHistoryResponse>('getLinkTransitionHistory', {
    contentId,
    issueKey
  });

  if (!Array.isArray(response.history)) {
    return [];
  }

  return response.history.map((entry) => ({
    id: entry.id,
    contentId: entry.contentId,
    issueKey: entry.issueKey,
    status: toStatus(entry.status),
    transitionVersion: entry.transitionVersion,
    transitionedAt: entry.transitionedAt,
    transitionedByAccountId: entry.transitionedByAccountId ?? null
  }));
};

export const emptyPageContext: PageContext = {
  siteUrl: '',
  pageTitle: '',
  pageSpaceKey: ''
};

export const toBylineError = (error: unknown): string => `Could not load linked issues (${getErrorMessage(error)})`;

/** Surfaces the resolver's own message so conflicts and invalid transitions read sensibly. */
export const toStatusUpdateError = (error: unknown): string => `Could not update status: ${getErrorMessage(error)}`;

/** Shown when a page has more links than one read can return. */
export const truncationWarning = (shown: number): string =>
  `Showing the ${shown} most recently updated links. This page has more links than can be displayed at once.`;
