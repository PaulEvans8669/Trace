import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_LINKS_LIMIT,
  findActiveByContent,
  findByContentAndIssue,
  findTransitionHistoryByContentAndIssue,
  revertStatusTransition,
  softUnlink,
  softUnlinkAllByContent,
  updateStatusWithTransition
} from './contentTicketLinksRepository';
import { executeSql } from '../utils/sql';

vi.mock('../utils/sql', async () => {
  // Keep the real result helpers; only the actual query execution is mocked.
  const actual = await vi.importActual<typeof import('../utils/sql')>('../utils/sql');
  return { ...actual, executeSql: vi.fn() };
});

describe('contentTicketLinksRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps a link row into a record', async () => {
    vi.mocked(executeSql).mockResolvedValueOnce({
      rows: [
        {
          id: 'id-1',
          content_id: '42',
          content_type: 'page',
          jira_issue_key: 'ABC-1',
          link_status: 'needs_review',
          linked_at: 100,
          updated_at: 200,
          last_transition_version: 7,
          last_transition_at: 200,
          unlinked_at: null
        }
      ]
    });

    const record = await findByContentAndIssue('42', 'ABC-1');

    expect(record).toEqual({
      id: 'id-1',
      contentId: '42',
      contentType: 'page',
      issueKey: 'ABC-1',
      status: 'needs_review',
      linkedAt: 100,
      updatedAt: 200,
      transitionVersion: 7,
      transitionAt: 200,
      unlinkedAt: null
    });
  });

  it('coerces BIGINT columns that arrive as strings', async () => {
    vi.mocked(executeSql).mockResolvedValueOnce({
      rows: [
        {
          id: 'id-1',
          content_id: '42',
          jira_issue_key: 'ABC-1',
          link_status: 'done',
          linked_at: '1700000000000',
          updated_at: '1700000000001',
          last_transition_version: '9',
          last_transition_at: '1700000000001',
          unlinked_at: null
        }
      ]
    });

    const record = await findByContentAndIssue('42', 'ABC-1');

    expect(record?.linkedAt).toBe(1700000000000);
    expect(record?.transitionVersion).toBe(9);
  });

  it('falls back to defaults for missing columns', async () => {
    vi.mocked(executeSql).mockResolvedValueOnce({ rows: [{ id: 'id-1' }] });

    const record = await findByContentAndIssue('42', 'ABC-1');

    expect(record?.contentType).toBe('page');
    expect(record?.status).toBe('not_started');
    expect(record?.linkedAt).toBe(0);
    expect(record?.transitionVersion).toBeNull();
  });

  it('returns null when no row matches', async () => {
    vi.mocked(executeSql).mockResolvedValueOnce({ rows: [] });

    expect(await findByContentAndIssue('42', 'ABC-1')).toBeNull();
  });

  it('returns an empty list when the result has no rows', async () => {
    vi.mocked(executeSql).mockResolvedValueOnce({});

    expect(await findActiveByContent('42')).toEqual({ links: [], truncated: false });
  });

  it('bounds the result set and reports truncation when more rows exist', async () => {
    // The query asks for LIMIT + 1 rows; the extra row is the signal that more exist, which
    // avoids a separate COUNT query just to answer "is there more?".
    const rows = Array.from({ length: ACTIVE_LINKS_LIMIT + 1 }, (_unused, index) => ({
      id: `id-${index}`,
      content_id: '42',
      content_type: 'page',
      jira_issue_key: `ABC-${index}`,
      link_status: 'not_started',
      linked_at: 1,
      updated_at: 1
    }));
    vi.mocked(executeSql).mockResolvedValueOnce({ rows });

    const result = await findActiveByContent('42');

    expect(result.truncated).toBe(true);
    expect(result.links).toHaveLength(ACTIVE_LINKS_LIMIT);
    expect(vi.mocked(executeSql)).toHaveBeenCalledWith(
      expect.stringContaining(`LIMIT ${ACTIVE_LINKS_LIMIT + 1}`),
      ['42']
    );
  });

  it('normalises a blank account id to null', async () => {
    vi.mocked(executeSql).mockResolvedValueOnce({
      rows: [
        {
          id: 'h-1',
          link_id: 'id-1',
          content_id: '42',
          jira_issue_key: 'ABC-1',
          link_status: 'done',
          transition_version: 3,
          transitioned_at: 5,
          transitioned_by_account_id: '   '
        }
      ]
    });

    const [entry] = await findTransitionHistoryByContentAndIssue('42', 'ABC-1');

    expect(entry?.transitionedByAccountId).toBeNull();
  });

  it('guards the status update with the expected current status', async () => {
    vi.mocked(executeSql).mockResolvedValueOnce({ rows: { affectedRows: 1 } });

    const affected = await updateStatusWithTransition('42', 'ABC-1', 'ongoing_work', 'done', 7, 1234);

    expect(affected).toBe(1);
    const [query, params] = vi.mocked(executeSql).mock.calls[0] ?? [];
    expect(query).toContain('link_status = ?');
    expect(params).toEqual(['done', 1234, 7, 1234, '42', 'ABC-1', 'ongoing_work']);
  });

  it('reports zero affected rows when the guarded update loses the race', async () => {
    vi.mocked(executeSql).mockResolvedValueOnce({ rows: { affectedRows: 0 } });

    expect(await updateStatusWithTransition('42', 'ABC-1', 'ongoing_work', 'done', 7, 1234)).toBe(0);
  });

  it('reports how many rows were soft unlinked', async () => {
    vi.mocked(executeSql).mockResolvedValueOnce({ rows: { affectedRows: 1 } });

    expect(await softUnlink('42', 'ABC-1', 999)).toBe(1);
  });

  it('guards the compensating revert with the status it is undoing', async () => {
    vi.mocked(executeSql).mockResolvedValueOnce({ rows: { affectedRows: 1 } });

    const affected = await revertStatusTransition('42', 'ABC-1', 'done', 'ongoing_work', 40, 5, 5);

    expect(affected).toBe(1);
    const [, params] = vi.mocked(executeSql).mock.calls[0] ?? [];
    // The trailing 'done' is the guard: a concurrent change means zero rows and no clobbering.
    expect(params).toEqual(['ongoing_work', 5, 40, 5, '42', 'ABC-1', 'done']);
  });

  it('soft-unlinks every active row for a deleted page', async () => {
    vi.mocked(executeSql).mockResolvedValueOnce({ rows: { affectedRows: 4 } });

    expect(await softUnlinkAllByContent('42', 999)).toBe(4);
    const [query] = vi.mocked(executeSql).mock.calls[0] ?? [];
    expect(query).toContain('unlinked_at IS NULL');
  });
});
