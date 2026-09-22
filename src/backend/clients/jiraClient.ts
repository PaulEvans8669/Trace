import api, { assumeTrustedRoute, route } from '@forge/api';

/**
 * Thin wrapper around the Jira REST API.
 *
 * Everything here runs `asUser()`, which means Jira applies the calling user's own permissions.
 * If the user cannot see an issue, Jira simply omits it from the response - we never have to
 * write our own permission checks for issue data.
 */

/** The subset of issue fields the UI actually renders. */
export interface JiraIssueSummary {
  issueKey: string;
  summary: string;
  issueTypeName: string;
  issueTypeIconUrl: string;
}

interface JiraSearchResponse {
  issues?: Array<{
    key?: string;
    fields?: {
      summary?: string;
      issuetype?: {
        name?: string;
        iconUrl?: string;
      };
    };
  }>;
}

/**
 * Jira issue keys look like `ABC-123`. We validate rather than escape because these values are
 * interpolated into a JQL string, and a strict allow-list is far safer than quoting rules.
 */
const ISSUE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

export const isValidIssueKey = (issueKey: string): boolean => {
  return ISSUE_KEY_PATTERN.test(issueKey);
};

/**
 * Jira's search endpoint caps how many issues one request may return. We page through in
 * chunks so a page with many linked issues still resolves in a predictable number of calls.
 */
const ISSUE_BATCH_SIZE = 100;

/**
 * Issue-type icons live behind authentication, so a UI Kit `<Image>` cannot load them by URL.
 * We fetch them once and inline them as data URLs. Icons are shared across issues of the same
 * type, so this per-invocation cache usually collapses N issues down to 1-3 image fetches.
 */
const iconDataUrlCache = new Map<string, Promise<string>>();

const fetchIconAsDataUrl = async (iconUrl: string): Promise<string> => {
  try {
    const parsedIconUrl = new URL(iconUrl);
    const restPathIndex = parsedIconUrl.pathname.indexOf('/rest/');
    if (restPathIndex < 0) {
      return '';
    }

    // `assumeTrustedRoute` is required because the path comes from a Jira API response rather
    // than from a literal `route` template. The URL is only ever used after we have confirmed
    // it points at this site's own /rest/ namespace.
    const jiraApiPath = `${parsedIconUrl.pathname.slice(restPathIndex)}${parsedIconUrl.search}`;
    const response = await api.asUser().requestJira(assumeTrustedRoute(jiraApiPath));
    if (!response.ok) {
      return '';
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    // An unusable icon is cosmetic only - the table falls back to a generic issue glyph.
    console.warn('Could not fetch Jira issue-type icon via authenticated API');
    return '';
  }
};

const getIconDataUrl = (iconUrl: string): Promise<string> => {
  if (!iconUrl) {
    return Promise.resolve('');
  }

  const cached = iconDataUrlCache.get(iconUrl);
  if (cached) {
    return cached;
  }

  const pending = fetchIconAsDataUrl(iconUrl);
  iconDataUrlCache.set(iconUrl, pending);
  return pending;
};

const searchIssueBatch = async (issueKeys: string[]): Promise<JiraSearchResponse['issues']> => {
  // Values are validated against ISSUE_KEY_PATTERN by the caller, so they are safe to inline.
  const jql = `key in (${issueKeys.join(',')})`;

  const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      jql,
      fields: ['summary', 'issuetype'],
      maxResults: issueKeys.length
    })
  });

  if (!response.ok) {
    throw new Error(`Jira issue lookup failed: ${response.status}`);
  }

  const body = (await response.json()) as JiraSearchResponse;
  return Array.isArray(body.issues) ? body.issues : [];
};

/**
 * Looks up many issues in one round trip.
 *
 * Issues the user cannot see (or that no longer exist) are simply absent from the result, so
 * callers should treat a missing key as "not visible" rather than as an error.
 */
export const getIssuesByKeys = async (issueKeys: string[]): Promise<JiraIssueSummary[]> => {
  const uniqueKeys = [...new Set(issueKeys.filter(isValidIssueKey))];
  if (uniqueKeys.length === 0) {
    return [];
  }

  const batches: string[][] = [];
  for (let index = 0; index < uniqueKeys.length; index += ISSUE_BATCH_SIZE) {
    batches.push(uniqueKeys.slice(index, index + ISSUE_BATCH_SIZE));
  }

  const batchResults = await Promise.all(batches.map((batch) => searchIssueBatch(batch)));
  const rawIssues = batchResults.flat();

  return Promise.all(
    rawIssues.map(async (issue): Promise<JiraIssueSummary> => {
      const issueKey = issue?.key || '';
      return {
        issueKey,
        summary: issue?.fields?.summary || issueKey,
        issueTypeName: issue?.fields?.issuetype?.name || 'Issue',
        issueTypeIconUrl: await getIconDataUrl(issue?.fields?.issuetype?.iconUrl || '')
      };
    })
  );
};

/**
 * Answers "may this user see this issue?" without paying for a search or for icon fetches.
 *
 * `getIssuesByKeys` could answer the same question, but it downloads and base64-encodes
 * issue-type icons - far too much work for a boolean. As in Confluence, a 403 and a 404 are
 * treated identically so we never reveal that a hidden issue exists.
 */
export const isIssueVisible = async (issueKey: string): Promise<boolean> => {
  if (!isValidIssueKey(issueKey)) {
    return false;
  }

  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary`);
  if (response.ok) {
    return true;
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return false;
  }

  // Outages must not masquerade as "you have no access", which would hide the user's own data.
  throw new Error(`Jira issue lookup failed: ${response.status}`);
};
