import { INITIAL_LINK_STATUS, type LinkStatus } from '../../shared/linkStatus';
import type { ContentTicketLinkRecord, ContentTicketLinkTransitionRecord } from '../types/storage';
import {
  affectedRowCount,
  executeSql,
  rowValue,
  selectFirstRow,
  selectRows,
  type SqlRow
} from '../utils/sql';

/**
 * Data access for the two link tables. This layer only knows about SQL and record shapes - no
 * REST calls and no business rules, both of which live in `services/linkService.ts`.
 */

/** Columns selected for a link row, kept in one place so the SELECTs cannot drift. */
const LINK_COLUMNS = `id, content_id, content_type, jira_issue_key, link_status, linked_at, updated_at,
                      last_transition_version, last_transition_at, unlinked_at`;

const TRANSITION_COLUMNS = `id, link_id, content_id, jira_issue_key, link_status,
                            transition_version, transitioned_at, transitioned_by_account_id`;

/**
 * MySQL may hand back BIGINT columns as strings depending on the driver, so numeric columns are
 * normalised defensively rather than trusted to already be numbers.
 */
const toNullableNumber = (value: number | string | null | undefined): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toNumber = (value: number | string | null | undefined, fallback = 0): number => {
  const parsed = toNullableNumber(value);
  return parsed === null ? fallback : parsed;
};

const toNullableString = (value: string | number | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const mapRowToRecord = (row: SqlRow): ContentTicketLinkRecord => {
  return {
    id: String(rowValue(row, 'id') || ''),
    contentId: String(rowValue(row, 'content_id') || ''),
    contentType: String(rowValue(row, 'content_type') || 'page'),
    issueKey: String(rowValue(row, 'jira_issue_key') || ''),
    status: String(rowValue(row, 'link_status') || INITIAL_LINK_STATUS) as LinkStatus,
    linkedAt: toNumber(rowValue(row, 'linked_at'), 0),
    updatedAt: toNumber(rowValue(row, 'updated_at'), 0),
    transitionVersion: toNullableNumber(rowValue(row, 'last_transition_version')),
    transitionAt: toNullableNumber(rowValue(row, 'last_transition_at')),
    unlinkedAt: toNullableNumber(rowValue(row, 'unlinked_at'))
  };
};

const mapTransitionRowToRecord = (row: SqlRow): ContentTicketLinkTransitionRecord => {
  return {
    id: String(rowValue(row, 'id') || ''),
    linkId: String(rowValue(row, 'link_id') || ''),
    contentId: String(rowValue(row, 'content_id') || ''),
    issueKey: String(rowValue(row, 'jira_issue_key') || ''),
    status: String(rowValue(row, 'link_status') || INITIAL_LINK_STATUS) as LinkStatus,
    transitionVersion: toNumber(rowValue(row, 'transition_version'), 0),
    transitionedAt: toNumber(rowValue(row, 'transitioned_at'), 0),
    transitionedByAccountId: toNullableString(rowValue(row, 'transitioned_by_account_id'))
  };
};

export const findByContentAndIssue = async (
  contentId: string,
  issueKey: string
): Promise<ContentTicketLinkRecord | null> => {
  const queryResult = await executeSql(
    `SELECT ${LINK_COLUMNS}
     FROM content_ticket_links
     WHERE content_id = ? AND jira_issue_key = ?`,
    [contentId, issueKey]
  );
  const row = selectFirstRow(queryResult);
  return row ? mapRowToRecord(row) : null;
};

/**
 * Upper bound on how many links one page or one issue will return.
 *
 * Without a bound, a pathological row count would mean many batched REST calls inside a
 * function that has a hard execution timeout - the panel would fail entirely rather than
 * degrade. The UI paginates at five rows, so this ceiling is far above any realistic use.
 */
export const ACTIVE_LINKS_LIMIT = 200;

/** A bounded result set, plus a flag so the UI can tell the user it is not seeing everything. */
export interface ActiveLinksPage {
  links: ContentTicketLinkRecord[];
  truncated: boolean;
}

/**
 * Selects one row more than the limit. If that extra row comes back we know more exist, which
 * saves a separate COUNT query just to answer "is there more?".
 */
const toActiveLinksPage = (rows: SqlRow[]): ActiveLinksPage => {
  const truncated = rows.length > ACTIVE_LINKS_LIMIT;
  return {
    links: rows.slice(0, ACTIVE_LINKS_LIMIT).map(mapRowToRecord),
    truncated
  };
};

/**
 * Interpolated rather than bound as a parameter: not every MySQL-compatible engine accepts a
 * placeholder in a LIMIT clause. This is a hardcoded numeric constant, never user input, so
 * there is nothing to inject.
 */
const ACTIVE_LINKS_FETCH_SIZE = ACTIVE_LINKS_LIMIT + 1;

export const findActiveByContent = async (contentId: string): Promise<ActiveLinksPage> => {
  const queryResult = await executeSql(
    `SELECT ${LINK_COLUMNS}
     FROM content_ticket_links
     WHERE content_id = ? AND unlinked_at IS NULL
     ORDER BY updated_at DESC
     LIMIT ${ACTIVE_LINKS_FETCH_SIZE}`,
    [contentId]
  );
  return toActiveLinksPage(selectRows(queryResult));
};

export const findActiveByIssue = async (issueKey: string): Promise<ActiveLinksPage> => {
  const queryResult = await executeSql(
    `SELECT ${LINK_COLUMNS}
     FROM content_ticket_links
     WHERE jira_issue_key = ? AND unlinked_at IS NULL
     ORDER BY updated_at DESC
     LIMIT ${ACTIVE_LINKS_FETCH_SIZE}`,
    [issueKey]
  );
  return toActiveLinksPage(selectRows(queryResult));
};

export const insertLink = async (
  id: string,
  contentId: string,
  contentType: string,
  issueKey: string,
  timestamp: number
): Promise<void> => {
  await executeSql(
    `INSERT INTO content_ticket_links (
      id, content_id, content_type, jira_issue_key, link_status, linked_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, contentId, contentType, issueKey, INITIAL_LINK_STATUS, timestamp, timestamp]
  );
};

/** Reactivates a previously soft-unlinked row, resetting it back to the initial status. */
export const relink = async (id: string, contentType: string, timestamp: number): Promise<void> => {
  await executeSql(
    `UPDATE content_ticket_links
     SET content_type = ?, link_status = ?, linked_at = ?, updated_at = ?, unlinked_at = NULL,
         last_transition_version = NULL, last_transition_at = NULL
     WHERE id = ?`,
    [contentType, INITIAL_LINK_STATUS, timestamp, timestamp, id]
  );
};

/**
 * Soft delete: the row is kept so that relinking preserves its id and transition history.
 * Returns how many rows were unlinked so the caller can report "nothing to unlink".
 */
export const softUnlink = async (contentId: string, issueKey: string, timestamp: number): Promise<number> => {
  const result = await executeSql(
    `UPDATE content_ticket_links
     SET unlinked_at = ?, updated_at = ?
     WHERE content_id = ? AND jira_issue_key = ? AND unlinked_at IS NULL`,
    [timestamp, timestamp, contentId, issueKey]
  );
  return affectedRowCount(result);
};

/**
 * Applies a status transition, but only if the row is still in the status the caller believed
 * it was in. This is optimistic concurrency control: if two people transition the same link at
 * once, the second UPDATE matches zero rows and the caller can surface a conflict instead of
 * silently overwriting the first change.
 *
 * Returns the number of rows updated (1 on success, 0 on conflict).
 */
export const updateStatusWithTransition = async (
  contentId: string,
  issueKey: string,
  expectedStatus: LinkStatus,
  newStatus: LinkStatus,
  transitionVersion: number,
  transitionTimestamp: number
): Promise<number> => {
  const result = await executeSql(
    `UPDATE content_ticket_links
     SET link_status = ?, updated_at = ?, last_transition_version = ?, last_transition_at = ?
     WHERE content_id = ? AND jira_issue_key = ? AND unlinked_at IS NULL AND link_status = ?`,
    [newStatus, transitionTimestamp, transitionVersion, transitionTimestamp, contentId, issueKey, expectedStatus]
  );
  return affectedRowCount(result);
};

/**
 * Restores a link to a previous status snapshot.
 *
 * Forge SQL has no transaction API, so a status update and its history row cannot be written
 * atomically. This is the compensating action used when the history write fails after the
 * status update succeeded: rather than leave a status change with no audit trail, we put the
 * row back exactly as it was. Guarded on the current status so it can never clobber a
 * concurrent change made in between.
 */
export const revertStatusTransition = async (
  contentId: string,
  issueKey: string,
  currentStatus: LinkStatus,
  previousStatus: LinkStatus,
  previousTransitionVersion: number | null,
  previousTransitionAt: number | null,
  previousUpdatedAt: number
): Promise<number> => {
  const result = await executeSql(
    `UPDATE content_ticket_links
     SET link_status = ?, updated_at = ?, last_transition_version = ?, last_transition_at = ?
     WHERE content_id = ? AND jira_issue_key = ? AND link_status = ?`,
    [
      previousStatus,
      previousUpdatedAt,
      previousTransitionVersion,
      previousTransitionAt,
      contentId,
      issueKey,
      currentStatus
    ]
  );
  return affectedRowCount(result);
};

/**
 * Soft-unlinks every active link for a deleted page or a deleted issue.
 *
 * Driven by the product triggers in `manifest.yml`. Rows are kept rather than deleted so the
 * transition history remains intact for auditing.
 */
export const softUnlinkAllByContent = async (contentId: string, timestamp: number): Promise<number> => {
  const result = await executeSql(
    `UPDATE content_ticket_links
     SET unlinked_at = ?, updated_at = ?
     WHERE content_id = ? AND unlinked_at IS NULL`,
    [timestamp, timestamp, contentId]
  );
  return affectedRowCount(result);
};

export const softUnlinkAllByIssue = async (issueKey: string, timestamp: number): Promise<number> => {
  const result = await executeSql(
    `UPDATE content_ticket_links
     SET unlinked_at = ?, updated_at = ?
     WHERE jira_issue_key = ? AND unlinked_at IS NULL`,
    [timestamp, timestamp, issueKey]
  );
  return affectedRowCount(result);
};

export const insertTransitionHistory = async (
  id: string,
  linkId: string,
  contentId: string,
  issueKey: string,
  status: LinkStatus,
  transitionVersion: number,
  transitionedAt: number,
  transitionedByAccountId: string | null
): Promise<void> => {
  await executeSql(
    `INSERT INTO content_ticket_link_transitions (
      id, link_id, content_id, jira_issue_key, link_status,
      transition_version, transitioned_at, transitioned_by_account_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, linkId, contentId, issueKey, status, transitionVersion, transitionedAt, transitionedByAccountId]
  );
};

export const findTransitionHistoryByContentAndIssue = async (
  contentId: string,
  issueKey: string
): Promise<ContentTicketLinkTransitionRecord[]> => {
  const queryResult = await executeSql(
    `SELECT ${TRANSITION_COLUMNS}
     FROM content_ticket_link_transitions
     WHERE content_id = ? AND jira_issue_key = ?
     ORDER BY transitioned_at DESC`,
    [contentId, issueKey]
  );
  return selectRows(queryResult).map(mapTransitionRowToRecord);
};
