import { CONTENT_TYPES, type ContentType } from '../../shared/contentType';

/**
 * Builds the CQL queries used by the content picker.
 *
 * CQL is a query language, so every value that reaches it has to be either escaped or drawn
 * from a fixed allow-list. The rules differ per position, which is why this is a module rather
 * than a template string scattered through the client:
 *
 *  - **Type tokens** are bare identifiers that cannot be quoted, so they are never taken from
 *    user input - only from `CONTENT_TYPES`.
 *  - **String literals** are double-quoted, so backslashes and quotes must be escaped.
 *  - **`text ~` values** are additionally parsed as Lucene, where characters like `*`, `~` and
 *    `:` carry meaning. They are stripped rather than escaped, because a user typing `C++`
 *    means the literal text, not a Lucene operator.
 */

/** CQL string literals are double-quoted, so backslashes and quotes must be escaped. */
export const escapeCqlString = (value: string): string => {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
};

/**
 * Removes the characters Lucene treats as operators inside a `~` match.
 *
 * Escaping them would also work, but stripping keeps the query readable in logs and avoids a
 * second layer of backslashes that then has to survive CQL escaping too. Whitespace is
 * collapsed so a stripped operator does not leave a double space behind.
 */
export const sanitiseTextTerm = (value: string): string => {
  return value
    .replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const toTypeClause = (types: readonly ContentType[]): string => {
  // Guard against an empty or unrecognised selection silently matching everything.
  const allowed = types.filter((type) => CONTENT_TYPES.includes(type));
  const resolved = allowed.length > 0 ? allowed : CONTENT_TYPES;
  return `type IN (${resolved.join(', ')})`;
};

const toSpaceClause = (spaceKeys: readonly string[]): string | null => {
  const keys = spaceKeys.map((key) => key.trim()).filter((key) => key.length > 0);
  if (keys.length === 0) {
    return null;
  }

  // Space keys can start with a digit, which CQL only accepts when quoted.
  return `space IN (${keys.map((key) => `"${escapeCqlString(key)}"`).join(', ')})`;
};

export interface SearchCqlOptions {
  query: string;
  types: readonly ContentType[];
  spaceKeys?: readonly string[];
}

/**
 * The query used once the user has typed something.
 *
 * Two deliberate choices:
 *
 *  1. **Both `title` and `text` are matched.** `title ~ "foo*"` gives prefix matching, which is
 *     what makes results feel responsive mid-word; `text ~ "foo"` reaches the body and labels,
 *     so "the SSO runbook" finds a page that never says "SSO" in its title. The previous
 *     implementation searched titles only.
 *
 *  2. **There is no `ORDER BY`.** Confluence ranks results by relevance and returns a `score`;
 *     adding `ORDER BY lastmodified DESC` (as the previous implementation did) discards that
 *     ranking entirely and surfaces whatever was edited most recently instead of what matches.
 */
export const buildSearchCql = ({ query, types, spaceKeys = [] }: SearchCqlOptions): string => {
  const term = sanitiseTextTerm(query);
  if (!term) {
    throw new Error('buildSearchCql requires a non-empty query');
  }

  const escaped = escapeCqlString(term);
  const clauses = [`(title ~ "${escaped}*" OR text ~ "${escaped}")`, toTypeClause(types)];

  const spaceClause = toSpaceClause(spaceKeys);
  if (spaceClause) {
    clauses.push(spaceClause);
  }

  return clauses.join(' AND ');
};

/**
 * The query used before the user types anything.
 *
 * An empty picker is a wasted opportunity: most links are to something the user just worked on.
 * `contributor = currentUser()` covers both authoring and editing, and here `ORDER BY` is
 * correct precisely because there is no relevance score to preserve.
 */
export const buildRecentCql = ({
  types,
  spaceKeys = []
}: Omit<SearchCqlOptions, 'query'>): string => {
  const clauses = [toTypeClause(types), 'contributor = currentUser()'];

  const spaceClause = toSpaceClause(spaceKeys);
  if (spaceClause) {
    clauses.push(spaceClause);
  }

  return `${clauses.join(' AND ')} ORDER BY lastmodified DESC`;
};

/** Looks up a known set of content ids, regardless of their type. */
export const buildIdsCql = (contentIds: readonly string[]): string => {
  return `id in (${contentIds.join(',')})`;
};
