import type { SearchPayload } from '../types/contracts';
import { getPagesByIds, searchContent, type ConfluenceSearchResult } from '../clients/confluenceClient';
import { parseContentLink } from '../clients/contentLink';
import { CONTENT_TYPES, isContentType, toContentType, type ContentType } from '../../shared/contentType';

/**
 * Resolver-facing wrapper around the Confluence search client.
 *
 * Only the picker's search lives here. Content *details* used to be a separate endpoint, but the
 * link read paths already fetch them while checking permissions, so they are returned from
 * `linkService` instead of being requested a second time.
 */

/** Keeps a hand-crafted invoke from widening the search beyond what the app supports. */
const toRequestedTypes = (types: unknown): ContentType[] => {
  if (!Array.isArray(types)) {
    return [...CONTENT_TYPES];
  }

  const requested = types.filter(isContentType);
  return requested.length > 0 ? requested : [...CONTENT_TYPES];
};

const toSpaceKeys = (spaceKeys: unknown): string[] => {
  if (!Array.isArray(spaceKeys)) {
    return [];
  }

  return spaceKeys.filter((key): key is string => typeof key === 'string' && key.trim().length > 0);
};

/**
 * Turns a pasted Confluence link into a single search result.
 *
 * The lookup goes through `getPagesByIds`, the same permission-filtered path the panels use, so
 * a fabricated or guessed URL resolves to nothing rather than confirming that content exists.
 * Returns `null` when the id is unreadable, letting the caller fall back to a text search.
 */
const resolvePastedLink = async (contentId: string): Promise<ConfluenceSearchResult | null> => {
  const detailsById = await getPagesByIds([contentId]);
  const details = detailsById.get(contentId);
  if (!details) {
    return null;
  }

  // Pasting a space overview URL is the most likely way to reach one, since it is the page a
  // user is most often looking at when they copy a Confluence link. It is rejected here for the
  // same reason the search filters it out: nothing would render on the Confluence side.
  if (details.isSpaceOverview) {
    return null;
  }

  return {
    id: details.id,
    title: details.title,
    spaceKey: details.spaceKey,
    spaceName: details.spaceName,
    contentType: toContentType(details.contentType),
    webUrl: details.webUrl,
    excerpt: '',
    excerptMatches: [],
    breadcrumb: details.spaceName,
    lastModified: ''
  };
};

export const searchConfluenceContent = async ({ payload }: { payload: SearchPayload }) => {
  const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
  const types = toRequestedTypes(payload?.types);
  const spaceKeys = toSpaceKeys(payload?.spaceKeys);
  const cursor = typeof payload?.cursor === 'string' && payload.cursor ? payload.cursor : undefined;

  // A pasted link is resolved directly: running a URL through the text search matches nothing,
  // because a URL shares no words with the content it points at. Only on a first page, since
  // "load more" on a single resolved link is meaningless.
  if (!cursor) {
    const parsed = parseContentLink(query);
    if (parsed) {
      const resolved = await resolvePastedLink(parsed.contentId);
      if (resolved && types.includes(resolved.contentType)) {
        return { results: [resolved], nextCursor: null, resolvedFromLink: true };
      }
    }
  }

  const page = await searchContent({
    query,
    types,
    spaceKeys,
    ...(cursor ? { cursor } : {})
  });

  return { ...page, resolvedFromLink: false };
};
