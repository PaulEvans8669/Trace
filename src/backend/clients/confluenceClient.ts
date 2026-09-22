import api, { assumeTrustedRoute, route } from '@forge/api';
import { buildIdsCql, buildRecentCql, buildSearchCql, sanitiseTextTerm } from './cql';
import { toContentType, type ContentType } from '../../shared/contentType';

/**
 * Thin wrapper around the Confluence REST API.
 *
 * As with the Jira client, every call runs `asUser()` so Confluence enforces the caller's own
 * permissions. Content the user cannot read is simply missing from the responses.
 */

interface ConfluenceContentV2Response {
  version?: {
    number?: number;
  };
}

interface ConfluenceSearchResponse {
  results?: Array<Record<string, unknown>>;
  _links?: {
    next?: string;
  };
}

export interface ConfluencePageDetails {
  id: string;
  title: string;
  spaceKey: string;
  spaceName: string;
  webUrl: string;
  contentType: string;
  /**
   * True when this page is its space's overview (the space homepage).
   *
   * An overview is a real page as far as the REST API is concerned, but Confluence renders it
   * inside the space shell at `/spaces/KEY/overview`, where the byline area belongs to the space
   * and our `confluence:contentBylineItem` never appears. Linking one would therefore produce a
   * half-broken link: visible from Jira, invisible from Confluence. So they are excluded.
   */
  isSpaceOverview: boolean;
}

/** A picker result: everything needed to render a rich row and then link it. */
export interface ConfluenceSearchResult {
  id: string;
  title: string;
  spaceKey: string;
  spaceName: string;
  contentType: ContentType;
  webUrl: string;
  /** Plain-text snippet with the matched terms removed from their highlight markers. */
  excerpt: string;
  /** Character ranges within `excerpt` that matched, so the UI can embolden them. */
  excerptMatches: Array<{ start: number; end: number }>;
  /** "Space > Parent > Child", from the search result's own breadcrumbs. */
  breadcrumb: string;
  /** Pre-formatted by Confluence, e.g. "3 days ago". */
  lastModified: string;
}

export interface ConfluenceSearchPage {
  results: ConfluenceSearchResult[];
  /** Opaque cursor for the next page, or `null` when the last page has been reached. */
  nextCursor: string | null;
}

/** Confluence content ids are numeric strings; validating lets us safely inline them into CQL. */
const CONTENT_ID_PATTERN = /^\d+$/;

export const isValidContentId = (contentId: string): boolean => {
  return CONTENT_ID_PATTERN.test(contentId);
};

const readString = (source: Record<string, unknown>, key: string): string => {
  const value = source[key];
  return typeof value === 'string' ? value : '';
};

const readRecord = (source: Record<string, unknown>, key: string): Record<string, unknown> => {
  const value = source[key];
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
};

const readArray = (source: Record<string, unknown>, key: string): Array<Record<string, unknown>> => {
  const value = source[key];
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
};

/**
 * Confluence returns links as a relative `webui` path plus a `base`. Stitch them back together,
 * falling back to a `/wiki`-prefixed relative link when no base is supplied.
 */
const buildWebUrl = (entity: Record<string, unknown>): string => {
  const links = readRecord(entity, '_links');
  const relativeWebUrl = readString(links, 'webui');
  const baseUrl = readString(links, 'base');

  if (!relativeWebUrl) return '';
  if (relativeWebUrl.startsWith('http://') || relativeWebUrl.startsWith('https://')) return relativeWebUrl;
  if (baseUrl) return `${baseUrl}${relativeWebUrl}`;
  if (relativeWebUrl.startsWith('/spaces/')) return `/wiki${relativeWebUrl}`;
  return relativeWebUrl;
};

/**
 * Recognises the URL Confluence gives a space overview.
 *
 * The homepage of a space is the one page whose `webui` link is `/spaces/KEY/overview` rather
 * than `/spaces/KEY/pages/{id}/{title}`, so the link shape alone identifies it. This is the
 * fallback signal: it needs no extra expansion and works on responses where the space's
 * `homepage` was not expanded, such as the id lookups behind a pasted link.
 */
export const isSpaceOverviewUrl = (url: string): boolean => {
  if (!url) {
    return false;
  }

  // Strip the query string and fragment first so `/overview?src=sidebar` still matches.
  const path = url.split(/[?#]/)[0] ?? '';
  return /\/spaces\/[^/]+\/overview\/?$/i.test(path);
};

/**
 * Search results nest the real content under `content` for some result types and expose it at
 * the top level for others. This normalises both shapes into one flat record.
 */
export const toPageDetails = (result: Record<string, unknown>, fallbackId = ''): ConfluencePageDetails | null => {
  const content = readRecord(result, 'content');
  const topLevelSpace = readRecord(result, 'space');
  const space = Object.keys(topLevelSpace).length > 0 ? topLevelSpace : readRecord(content, 'space');

  const id = readString(result, 'id') || readString(content, 'id') || fallbackId;
  if (!id) {
    return null;
  }

  const webUrl =
    buildWebUrl(result) ||
    buildWebUrl(content) ||
    readString(result, 'url') ||
    `/wiki/pages/viewpage.action?pageId=${id}`;

  // Two signals, because either can be missing. The expanded homepage id is authoritative but
  // is only present when the caller asked for `content.space.homepage`; the URL shape always is.
  const homepageId = readString(readRecord(space, 'homepage'), 'id');
  const isSpaceOverview =
    (homepageId !== '' && homepageId === id) ||
    isSpaceOverviewUrl(webUrl) ||
    isSpaceOverviewUrl(readString(result, 'url'));

  return {
    id,
    title: readString(result, 'title') || readString(content, 'title') || 'Untitled page',
    spaceKey: readString(space, 'key'),
    spaceName: readString(space, 'name'),
    webUrl,
    contentType: readString(result, 'type') || readString(content, 'type') || 'page',
    isSpaceOverview
  };
};

/**
 * Strips characters that cannot render meaningfully.
 *
 * Confluence truncates excerpts to a fixed length server-side, and it counts UTF-16 code units,
 * so a cut can land *between* the two halves of a surrogate pair - an emoji in the page body
 * arrives as a lone surrogate and the browser draws it as "&#xFFFD;". Control characters come from
 * macros and tables. Both are noise, so they are dropped rather than passed to the UI.
 */
const stripUnrenderableCharacters = (value: string): string => {
  return value
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
};

/**
 * Confluence marks matched terms in an excerpt with `@@@hl@@@term@@@endhl@@@`.
 *
 * Those markers are useless to render directly, but throwing them away loses the one piece of
 * information that tells the user *why* a result matched. Splitting them into plain text plus
 * character ranges lets the UI embolden the matches itself.
 *
 * The raw excerpt is normalised *before* the markers are scanned, never after. Stripping a
 * character or collapsing a run of whitespace shifts every offset that follows it, so
 * normalising afterwards would leave the emphasis sitting a few characters off the word it is
 * meant to mark. The markers contain no whitespace of their own, so normalising first is safe.
 */
export const parseHighlightedExcerpt = (
  raw: string
): { text: string; matches: Array<{ start: number; end: number }> } => {
  const matches: Array<{ start: number; end: number }> = [];
  let text = '';
  // Excerpts arrive with newlines and runs of spaces from the page body.
  let remaining = stripUnrenderableCharacters(raw).replace(/\s+/g, ' ').trim();

  while (remaining.length > 0) {
    const openIndex = remaining.indexOf('@@@hl@@@');
    if (openIndex < 0) {
      text += remaining;
      break;
    }

    const closeIndex = remaining.indexOf('@@@endhl@@@', openIndex);
    if (closeIndex < 0) {
      // Unbalanced marker: keep the text, drop the stray opener.
      text += remaining.slice(0, openIndex) + remaining.slice(openIndex + '@@@hl@@@'.length);
      break;
    }

    text += remaining.slice(0, openIndex);
    const term = remaining.slice(openIndex + '@@@hl@@@'.length, closeIndex);
    matches.push({ start: text.length, end: text.length + term.length });
    text += term;
    remaining = remaining.slice(closeIndex + '@@@endhl@@@'.length);
  }

  return { text, matches };
};

/**
 * Builds "Space > Parent > Child" from a search result.
 *
 * `breadcrumbs` covers the ancestor pages but omits the space itself, which is the single most
 * useful piece of context when the same page title exists in several spaces.
 */
const buildBreadcrumb = (result: Record<string, unknown>, spaceName: string): string => {
  const segments = readArray(result, 'breadcrumbs')
    .map((crumb) => readString(crumb, 'label'))
    .filter((label) => label.length > 0);

  return [spaceName, ...segments].filter((segment) => segment.length > 0).join(' \u203a ');
};

const toSearchResult = (result: Record<string, unknown>): ConfluenceSearchResult | null => {
  const details = toPageDetails(result);
  if (!details) {
    return null;
  }

  // A space overview cannot show the byline item, so offering it in the picker would only lead
  // the user into a link that looks broken from the Confluence side.
  if (details.isSpaceOverview) {
    return null;
  }

  const excerpt = parseHighlightedExcerpt(readString(result, 'excerpt'));

  return {
    id: details.id,
    title: details.title,
    spaceKey: details.spaceKey,
    spaceName: details.spaceName,
    contentType: toContentType(details.contentType),
    webUrl: details.webUrl,
    excerpt: excerpt.text,
    excerptMatches: excerpt.matches,
    breadcrumb: buildBreadcrumb(result, details.spaceName),
    lastModified: readString(result, 'friendlyLastModified')
  };
};

/**
 * Confluence returns the next page as a full relative URL; only its `cursor` is reusable,
 * because the rest of the query is rebuilt from our own parameters each time.
 */
const extractCursor = (nextLink: string | undefined): string | null => {
  if (!nextLink) {
    return null;
  }

  const match = /[?&]cursor=([^&]+)/.exec(nextLink);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

/**
 * What the search and id-lookup calls ask Confluence to expand.
 *
 * `content.space` supplies the space key and name shown as context. `content.space.homepage` is
 * what lets a result be recognised as its space's overview, which is then filtered out.
 */
const SEARCH_EXPAND = 'content.space,content.space.homepage';

const runCqlSearch = async (cql: string, limit: number): Promise<Array<Record<string, unknown>>> => {
  const response = await api
    .asUser()
    .requestConfluence(route`/wiki/rest/api/search?cql=${cql}&expand=${SEARCH_EXPAND}&limit=${String(limit)}`);

  if (!response.ok) {
    throw new Error(`Confluence search failed: ${response.status}`);
  }

  const data = (await response.json()) as ConfluenceSearchResponse;
  return Array.isArray(data.results) ? data.results : [];
};


/** The v2 REST collection that serves each content type. */
const V2_PATHS: Record<ContentType, string> = {
  page: 'pages',
  blogpost: 'blogposts'
};

/**
 * Reads the current version number of a piece of content. This is stamped onto every status
 * transition so the history view can link back to the exact revision the transition was made
 * against.
 *
 * The type matters: a blog post is not readable through `/pages/{id}`, so passing the wrong
 * type returns 404 and the link would fail to record its baseline history.
 */
export const getContentVersion = async (contentId: string, contentType: ContentType): Promise<number> => {
  const response = await api
    .asUser()
    .requestConfluence(route`/wiki/api/v2/${V2_PATHS[contentType]}/${contentId}?include-version=true`);
  if (!response.ok) {
    throw new Error(`Confluence version lookup failed: ${response.status}`);
  }

  const contentData = (await response.json()) as ConfluenceContentV2Response;
  const versionNumber = contentData.version?.number;
  if (typeof versionNumber !== 'number' || !Number.isFinite(versionNumber)) {
    throw new Error(`Confluence version lookup failed: missing version number for content ${contentId}`);
  }
  return versionNumber;
};

/**
 * Minimum characters before a query is treated as a search rather than as "show me recent".
 *
 * One character is enough because the CQL uses a `title ~ "q*"` prefix match, so even a single
 * letter narrows meaningfully. This must stay in step with the picker's own floor, otherwise a
 * one-character query would quietly return recent content instead of matches.
 */
const MIN_SEARCH_QUERY_LENGTH = 1;
/**
 * Results per request.
 *
 * Deliberately generous: UI Kit exposes no scroll or intersection event, so "load more" can
 * never be automatic. A large page is what keeps the user from ever having to press it.
 */
const SEARCH_RESULT_LIMIT = 50;

export interface SearchContentOptions {
  query: string;
  types: readonly ContentType[];
  spaceKeys?: readonly string[];
  limit?: number;
  cursor?: string;
}

/**
 * Runs a picker search.
 *
 * An empty query is not an error - it returns the content the user recently worked on, which
 * is what the picker shows before anything is typed.
 */
export const searchContent = async ({
  query,
  types,
  spaceKeys = [],
  limit = SEARCH_RESULT_LIMIT,
  cursor
}: SearchContentOptions): Promise<ConfluenceSearchPage> => {
  const trimmed = query.trim();
  const hasQuery = trimmed.length >= MIN_SEARCH_QUERY_LENGTH && sanitiseTextTerm(trimmed).length > 0;

  const cql = hasQuery
    ? buildSearchCql({ query: trimmed, types, spaceKeys })
    : buildRecentCql({ types, spaceKeys });

  // `excerpt=highlight` is what produces the @@@hl@@@ markers we turn into bold ranges.
  const basePath = `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&expand=${encodeURIComponent(
    SEARCH_EXPAND
  )}&excerpt=highlight&limit=${encodeURIComponent(String(limit))}`;
  const path = cursor ? `${basePath}&cursor=${encodeURIComponent(cursor)}` : basePath;

  const response = await api.asUser().requestConfluence(assumeTrustedRoute(path));
  if (!response.ok) {
    throw new Error(`Confluence search failed: ${response.status}`);
  }

  const data = (await response.json()) as ConfluenceSearchResponse;
  const rawResults = Array.isArray(data.results) ? data.results : [];

  return {
    results: rawResults
      .map((result) => toSearchResult(result))
      .filter((result): result is ConfluenceSearchResult => result !== null),
    nextCursor: extractCursor(data._links?.next)
  };
};

/** Confluence rejects very long CQL strings, so `id in (...)` lookups are chunked. */
const PAGE_DETAILS_BATCH_SIZE = 50;

/**
 * Looks up many pages in one round trip, keyed by content id.
 *
 * Replaces the previous pattern of one full CQL search per linked page. Pages the user cannot
 * read are absent from the map, which also makes this usable as an authorization filter.
 */
export const getPagesByIds = async (contentIds: string[]): Promise<Map<string, ConfluencePageDetails>> => {
  const uniqueIds = [...new Set(contentIds.filter(isValidContentId))];
  const detailsById = new Map<string, ConfluencePageDetails>();
  if (uniqueIds.length === 0) {
    return detailsById;
  }

  const batches: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += PAGE_DETAILS_BATCH_SIZE) {
    batches.push(uniqueIds.slice(index, index + PAGE_DETAILS_BATCH_SIZE));
  }

  const batchResults = await Promise.all(
    batches.map((batch) => runCqlSearch(buildIdsCql(batch), batch.length))
  );

  batchResults.flat().forEach((result) => {
    const page = toPageDetails(result);
    if (page) {
      detailsById.set(page.id, page);
    }
  });

  return detailsById;
};

/**
 * Answers the yes/no question "may this user read this content?" as cheaply as possible.
 *
 * A CQL search would also work, but searching is a comparatively expensive operation for a
 * boolean answer. A direct v2 GET returns 403/404 for content the caller cannot read, which is
 * exactly the signal we need. Note that Confluence deliberately blurs "missing" and "forbidden"
 * here, and so do we - distinguishing them would leak the existence of restricted content.
 *
 * The type must be correct: blog posts are not served by `/pages/{id}`, so probing the wrong
 * collection reports a perfectly visible blog post as inaccessible.
 */
export const isContentVisible = async (contentId: string, contentType: ContentType): Promise<boolean> => {
  if (!isValidContentId(contentId)) {
    return false;
  }

  const response = await api.asUser().requestConfluence(route`/wiki/api/v2/${V2_PATHS[contentType]}/${contentId}`);
  if (response.ok) {
    return true;
  }
  if (response.status === 403 || response.status === 404) {
    return false;
  }

  // Anything else (429, 5xx, ...) is an outage rather than an authorization answer. Returning
  // `false` there would silently hide the user's own data, so we surface it as an error.
  throw new Error(`Confluence content lookup failed: ${response.status}`);
};
