import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentTicketLinkRecord } from '../types/storage';
import { AppError } from '../../shared/appError';
import {
  getBylineView,
  getIssuePanelView,
  getLinkTransitionHistory,
  handleContentDeleted,
  handleIssueDeleted,
  linkContentToTicket,
  unlinkContentFromTicket,
  updateLinkStatus
} from './linkService';
import {
  findActiveByContent,
  findActiveByIssue,
  findByContentAndIssue,
  findTransitionHistoryByContentAndIssue,
  insertLink,
  insertTransitionHistory,
  revertStatusTransition,
  softUnlink,
  softUnlinkAllByContent,
  softUnlinkAllByIssue,
  updateStatusWithTransition
} from '../repositories/contentTicketLinksRepository';
import { getContentVersion, getPagesByIds, isContentVisible } from '../clients/confluenceClient';
import { getIssuesByKeys, isIssueVisible } from '../clients/jiraClient';

vi.mock('../repositories/contentTicketLinksRepository', () => ({
  findActiveByContent: vi.fn(),
  findActiveByIssue: vi.fn(),
  findByContentAndIssue: vi.fn(),
  findTransitionHistoryByContentAndIssue: vi.fn(),
  insertLink: vi.fn(),
  insertTransitionHistory: vi.fn(),
  relink: vi.fn(),
  revertStatusTransition: vi.fn(),
  softUnlink: vi.fn(),
  softUnlinkAllByContent: vi.fn(),
  softUnlinkAllByIssue: vi.fn(),
  updateStatusWithTransition: vi.fn()
}));

// The validators are pure helpers, so the mocks keep their real behaviour.
vi.mock('../clients/confluenceClient', () => ({
  getContentVersion: vi.fn(),
  getPagesByIds: vi.fn(),
  isContentVisible: vi.fn(),
  isValidContentId: (contentId: string) => /^\d+$/.test(contentId)
}));

vi.mock('../clients/jiraClient', () => ({
  getIssuesByKeys: vi.fn(),
  isIssueVisible: vi.fn(),
  isValidIssueKey: (issueKey: string) => /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(issueKey)
}));

const buildLink = (overrides: Partial<ContentTicketLinkRecord> = {}): ContentTicketLinkRecord => ({
  id: 'id-1',
  contentId: '42',
  contentType: 'page',
  issueKey: 'ABC-1',
  status: 'not_started',
  linkedAt: 1,
  updatedAt: 1,
  transitionVersion: null,
  transitionAt: null,
  unlinkedAt: null,
  ...overrides
});

const buildPage = (id: string, contentType = 'page', isSpaceOverview = false) => ({
  id,
  title: `Page ${id}`,
  spaceKey: 'DOC',
  spaceName: 'Docs',
  webUrl: `/wiki/${id}`,
  contentType,
  isSpaceOverview
});

const buildIssue = (issueKey: string) => ({
  issueKey,
  summary: `Summary for ${issueKey}`,
  issueTypeName: 'Task',
  issueTypeIconUrl: 'data:image/png;base64,AAA'
});

/** Default to "everything is visible"; individual tests override to test the filtering. */
const allowAll = () => {
  vi.mocked(isContentVisible).mockResolvedValue(true);
  vi.mocked(isIssueVisible).mockResolvedValue(true);
  vi.mocked(getPagesByIds).mockResolvedValue(new Map([['42', buildPage('42')]]));
  vi.mocked(getIssuesByKeys).mockResolvedValue([buildIssue('ABC-1')]);
  vi.mocked(findActiveByContent).mockResolvedValue({ links: [], truncated: false });
  vi.mocked(findActiveByIssue).mockResolvedValue({ links: [], truncated: false });
  // The write paths read the link row before probing visibility, because its stored
  // content type decides which v2 collection to probe.
  vi.mocked(findByContentAndIssue).mockResolvedValue(buildLink());
};

describe('linkService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowAll();
  });

  describe('payload validation', () => {
    it('rejects a non-numeric content id', async () => {
      await expect(getBylineView({ payload: { contentId: 'not-an-id' } })).rejects.toThrow(
        'contentId must be a numeric Confluence content id'
      );
    });

    it('rejects a malformed issue key', async () => {
      await expect(getIssuePanelView({ payload: { issueKey: 'nope' } })).rejects.toThrow('issueKey must look like');
    });

    it('rejects a missing content id', async () => {
      await expect(getBylineView({ payload: { contentId: '' } })).rejects.toThrow('contentId is required');
    });

    it('tags validation failures with the VALIDATION code', async () => {
      await expect(getBylineView({ payload: { contentId: '' } })).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  describe('linkContentToTicket', () => {
    it('creates a new link and seeds its history', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(null);
      vi.mocked(getContentVersion).mockResolvedValueOnce(12);

      const result = await linkContentToTicket({
        payload: { contentId: '42', issueKey: 'ABC-1' },
        contextAccountId: 'user-123'
      });

      expect(result.linkId).toEqual(expect.any(String));
      expect(vi.mocked(insertLink)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(insertTransitionHistory)).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        '42',
        'ABC-1',
        'not_started',
        12,
        expect.any(Number),
        'user-123'
      );
    });

    it('takes the content type from Confluence rather than from the caller', async () => {
      vi.mocked(getPagesByIds).mockResolvedValue(new Map([['42', buildPage('42', 'blogpost')]]));
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(null);
      vi.mocked(getContentVersion).mockResolvedValueOnce(1);

      await linkContentToTicket({
        // A malicious caller claiming this page is something else must be ignored.
        payload: { contentId: '42', issueKey: 'ABC-1', contentType: 'attachment' }
      });

      expect(vi.mocked(insertLink)).toHaveBeenCalledWith(
        expect.any(String),
        '42',
        'blogpost',
        'ABC-1',
        expect.any(Number)
      );
    });

    it('records a null account id when the caller is unknown', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(null);
      vi.mocked(getContentVersion).mockResolvedValueOnce(3);

      await linkContentToTicket({ payload: { contentId: '42', issueKey: 'ABC-1' } });

      expect(vi.mocked(insertTransitionHistory)).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        '42',
        'ABC-1',
        'not_started',
        3,
        expect.any(Number),
        null
      );
    });

    it('is idempotent when the link already exists', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(buildLink());

      const result = await linkContentToTicket({ payload: { contentId: '42', issueKey: 'ABC-1' } });

      expect(result.message).toContain('already linked');
      expect(vi.mocked(insertLink)).not.toHaveBeenCalled();
    });

    it('refuses to link a page the user cannot read', async () => {
      vi.mocked(getPagesByIds).mockResolvedValue(new Map());

      await expect(linkContentToTicket({ payload: { contentId: '42', issueKey: 'ABC-1' } })).rejects.toMatchObject({
        code: 'NOT_FOUND'
      });
      expect(vi.mocked(insertLink)).not.toHaveBeenCalled();
    });

    it('refuses to link a space overview', async () => {
      // The byline item does not render on a space overview, so the link would be invisible from
      // the Confluence side - a link only half of which exists is worse than no link.
      vi.mocked(getPagesByIds).mockResolvedValue(new Map([['42', buildPage('42', 'page', true)]]));

      await expect(linkContentToTicket({ payload: { contentId: '42', issueKey: 'ABC-1' } })).rejects.toMatchObject({
        code: 'VALIDATION'
      });
      expect(vi.mocked(insertLink)).not.toHaveBeenCalled();
    });

    it('refuses to link an issue the user cannot see', async () => {
      vi.mocked(isIssueVisible).mockResolvedValue(false);

      await expect(linkContentToTicket({ payload: { contentId: '42', issueKey: 'ABC-1' } })).rejects.toThrow(
        'Issue not found or not accessible'
      );
      expect(vi.mocked(insertLink)).not.toHaveBeenCalled();
    });
  });

  describe('unlinkContentFromTicket', () => {
    it('reports when there was no active link to remove', async () => {
      vi.mocked(softUnlink).mockResolvedValueOnce(0);

      const result = await unlinkContentFromTicket({ payload: { contentId: '42', issueKey: 'ABC-1' } });

      expect(result.message).toContain('No active link');
    });

    it('reports when the link row is already unlinked, without calling Confluence', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(buildLink({ unlinkedAt: 5 }));

      const result = await unlinkContentFromTicket({ payload: { contentId: '42', issueKey: 'ABC-1' } });

      expect(result.message).toContain('No active link');
      expect(vi.mocked(isContentVisible)).not.toHaveBeenCalled();
      expect(vi.mocked(softUnlink)).not.toHaveBeenCalled();
    });

    it('confirms a successful unlink', async () => {
      vi.mocked(softUnlink).mockResolvedValueOnce(1);

      const result = await unlinkContentFromTicket({ payload: { contentId: '42', issueKey: 'ABC-1' } });

      expect(result.message).toContain('unlinked from issue ABC-1');
    });

    it('uses the cheap visibility probe rather than a full page fetch', async () => {
      vi.mocked(softUnlink).mockResolvedValueOnce(1);

      await unlinkContentFromTicket({ payload: { contentId: '42', issueKey: 'ABC-1' } });

      expect(vi.mocked(isContentVisible)).toHaveBeenCalledWith('42', 'page');
      expect(vi.mocked(getPagesByIds)).not.toHaveBeenCalled();
    });

    it('probes the blogposts collection for a linked blog post', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(buildLink({ contentType: 'blogpost' }));
      vi.mocked(softUnlink).mockResolvedValueOnce(1);

      await unlinkContentFromTicket({ payload: { contentId: '42', issueKey: 'ABC-1' } });

      // Probing a blog post as a page 404s, which would reject a perfectly visible link.
      expect(vi.mocked(isContentVisible)).toHaveBeenCalledWith('42', 'blogpost');
    });
  });

  describe('updateLinkStatus', () => {
    it('applies a legal transition and records history', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(buildLink({ status: 'ongoing_work' }));
      vi.mocked(getContentVersion).mockResolvedValueOnce(43);
      vi.mocked(updateStatusWithTransition).mockResolvedValueOnce(1);

      const result = await updateLinkStatus({
        payload: { contentId: '42', issueKey: 'ABC-1', newStatus: 'done' },
        contextAccountId: 'user-123'
      });

      expect(result.transition.confluenceVersion).toBe(43);
      expect(vi.mocked(updateStatusWithTransition)).toHaveBeenCalledWith(
        '42',
        'ABC-1',
        'ongoing_work',
        'done',
        43,
        expect.any(Number)
      );
      expect(vi.mocked(insertTransitionHistory)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(revertStatusTransition)).not.toHaveBeenCalled();
    });

    it('rejects a transition that is not an edge in the state machine', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(buildLink({ status: 'not_started' }));

      await expect(
        updateLinkStatus({ payload: { contentId: '42', issueKey: 'ABC-1', newStatus: 'done' } })
      ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

      expect(vi.mocked(updateStatusWithTransition)).not.toHaveBeenCalled();
      expect(vi.mocked(insertTransitionHistory)).not.toHaveBeenCalled();
    });

    it('rejects an unknown status', async () => {
      await expect(
        updateLinkStatus({
          payload: { contentId: '42', issueKey: 'ABC-1', newStatus: 'banana' as never }
        })
      ).rejects.toThrow('Invalid status: banana');
    });

    it('raises a CONFLICT when another request changed the status first', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(buildLink({ status: 'ongoing_work' }));
      vi.mocked(getContentVersion).mockResolvedValueOnce(43);
      vi.mocked(updateStatusWithTransition).mockResolvedValueOnce(0);

      const error = await updateLinkStatus({
        payload: { contentId: '42', issueKey: 'ABC-1', newStatus: 'done' }
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('CONFLICT');
      // The history must not record a transition that never actually landed.
      expect(vi.mocked(insertTransitionHistory)).not.toHaveBeenCalled();
    });

    it('reverts the status when the history write fails', async () => {
      // Forge SQL has no transactions, so the service compensates by hand. The invariant is
      // that a status change never exists without a matching audit entry.
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(
        buildLink({ status: 'ongoing_work', transitionVersion: 40, transitionAt: 5, updatedAt: 5 })
      );
      vi.mocked(getContentVersion).mockResolvedValueOnce(43);
      vi.mocked(updateStatusWithTransition).mockResolvedValueOnce(1);
      vi.mocked(insertTransitionHistory).mockRejectedValueOnce(new Error('history table unavailable'));
      vi.mocked(revertStatusTransition).mockResolvedValueOnce(1);

      await expect(
        updateLinkStatus({ payload: { contentId: '42', issueKey: 'ABC-1', newStatus: 'done' } })
      ).rejects.toThrow('history table unavailable');

      expect(vi.mocked(revertStatusTransition)).toHaveBeenCalledWith('42', 'ABC-1', 'done', 'ongoing_work', 40, 5, 5);
    });

    it('still surfaces the original failure when the revert itself fails', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(buildLink({ status: 'ongoing_work' }));
      vi.mocked(getContentVersion).mockResolvedValueOnce(43);
      vi.mocked(updateStatusWithTransition).mockResolvedValueOnce(1);
      vi.mocked(insertTransitionHistory).mockRejectedValueOnce(new Error('history table unavailable'));
      vi.mocked(revertStatusTransition).mockRejectedValueOnce(new Error('revert also failed'));

      await expect(
        updateLinkStatus({ payload: { contentId: '42', issueKey: 'ABC-1', newStatus: 'done' } })
      ).rejects.toThrow('history table unavailable');
    });

    it('rejects a status update when the link is missing', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(null);

      await expect(
        updateLinkStatus({ payload: { contentId: '42', issueKey: 'ABC-1', newStatus: 'ongoing_work' } })
      ).rejects.toThrow('Cannot transition an unlinked or missing content-ticket link');
    });

    it('rejects a status update on an unlinked row', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(buildLink({ unlinkedAt: 999 }));

      await expect(
        updateLinkStatus({ payload: { contentId: '42', issueKey: 'ABC-1', newStatus: 'ongoing_work' } })
      ).rejects.toThrow('Cannot transition an unlinked or missing content-ticket link');
    });
  });

  describe('getBylineView', () => {
    it('returns links enriched with the Jira metadata fetched during the permission check', async () => {
      vi.mocked(findActiveByContent).mockResolvedValue({
        links: [buildLink({ status: 'needs_review', updatedAt: 2, transitionVersion: 43, transitionAt: 2 })],
        truncated: false
      });

      const result = await getBylineView({ payload: { contentId: '42' } });

      expect(result.page.title).toBe('Page 42');
      expect(result.links).toEqual([
        {
          id: 'id-1',
          contentId: '42',
          issueKey: 'ABC-1',
          status: 'needs_review',
          linkedAt: 1,
          updatedAt: 2,
          transitionVersion: 43,
          transitionAt: 2,
          summary: 'Summary for ABC-1',
          issueTypeName: 'Task',
          issueTypeIconUrl: 'data:image/png;base64,AAA'
        }
      ]);
    });

    it('loads the panel with exactly two product calls', async () => {
      vi.mocked(findActiveByContent).mockResolvedValue({ links: [buildLink()], truncated: false });

      await getBylineView({ payload: { contentId: '42' } });

      // One Confluence lookup and one Jira lookup - each doing double duty as the permission
      // check and as the data source. A regression here means the double-fetch is back.
      expect(vi.mocked(getPagesByIds)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(getIssuesByKeys)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(isContentVisible)).not.toHaveBeenCalled();
    });

    it('hides links whose issue the user cannot see', async () => {
      vi.mocked(findActiveByContent).mockResolvedValue({
        links: [buildLink({ id: 'visible', issueKey: 'ABC-1' }), buildLink({ id: 'hidden', issueKey: 'SECRET-9' })],
        truncated: false
      });

      const result = await getBylineView({ payload: { contentId: '42' } });

      expect(result.links.map((link) => link.id)).toEqual(['visible']);
    });

    it('rejects a page the user cannot read', async () => {
      vi.mocked(getPagesByIds).mockResolvedValue(new Map());

      await expect(getBylineView({ payload: { contentId: '42' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('passes the truncation flag through to the UI', async () => {
      vi.mocked(findActiveByContent).mockResolvedValue({ links: [buildLink()], truncated: true });

      const result = await getBylineView({ payload: { contentId: '42' } });

      expect(result.truncated).toBe(true);
    });
  });

  describe('getIssuePanelView', () => {
    it('returns links enriched with the Confluence metadata from the permission check', async () => {
      vi.mocked(findActiveByIssue).mockResolvedValue({ links: [buildLink()], truncated: false });

      const result = await getIssuePanelView({ payload: { issueKey: 'ABC-1' } });

      expect(result.links).toEqual([
        {
          id: 'id-1',
          contentId: '42',
          contentType: 'page',
          status: 'not_started',
          linkedAt: 1,
          updatedAt: 1,
          title: 'Page 42',
          spaceKey: 'DOC',
          spaceName: 'Docs',
          webUrl: '/wiki/42'
        }
      ]);
    });

    it('hides links whose page the user cannot read', async () => {
      vi.mocked(findActiveByIssue).mockResolvedValue({
        links: [buildLink({ id: 'visible', contentId: '42' }), buildLink({ id: 'hidden', contentId: '99' })],
        truncated: false
      });

      const result = await getIssuePanelView({ payload: { issueKey: 'ABC-1' } });

      expect(result.links.map((link) => link.id)).toEqual(['visible']);
    });

    it('rejects an issue the user cannot see', async () => {
      vi.mocked(isIssueVisible).mockResolvedValue(false);

      await expect(getIssuePanelView({ payload: { issueKey: 'ABC-1' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('transition history', () => {
    it('returns an empty history rather than fabricating one', async () => {
      vi.mocked(findTransitionHistoryByContentAndIssue).mockResolvedValueOnce([]);

      const result = await getLinkTransitionHistory({ payload: { contentId: '42', issueKey: 'ABC-1' } });

      expect(result.history).toEqual([]);
    });

    it('probes visibility using the link row stored content type', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(buildLink({ contentType: 'blogpost' }));
      vi.mocked(findTransitionHistoryByContentAndIssue).mockResolvedValueOnce([]);

      await getLinkTransitionHistory({ payload: { contentId: '42', issueKey: 'ABC-1' } });

      // The row is read first precisely so the right v2 collection is probed.
      expect(vi.mocked(isContentVisible)).toHaveBeenCalledWith('42', 'blogpost');
    });

    it('rejects history for a link that does not exist', async () => {
      vi.mocked(findByContentAndIssue).mockResolvedValueOnce(null);

      await expect(
        getLinkTransitionHistory({ payload: { contentId: '42', issueKey: 'ABC-1' } })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('passes through recorded history entries', async () => {
      vi.mocked(findTransitionHistoryByContentAndIssue).mockResolvedValueOnce([
        {
          id: 'h-1',
          linkId: 'id-1',
          contentId: '42',
          issueKey: 'ABC-1',
          status: 'done',
          transitionVersion: 10,
          transitionedAt: 9,
          transitionedByAccountId: null
        }
      ]);

      const result = await getLinkTransitionHistory({ payload: { contentId: '42', issueKey: 'ABC-1' } });

      expect(result.history).toEqual([
        {
          id: 'h-1',
          contentId: '42',
          issueKey: 'ABC-1',
          status: 'done',
          transitionVersion: 10,
          transitionedAt: 9,
          transitionedByAccountId: null
        }
      ]);
    });
  });

  describe('deletion cleanup', () => {
    it('soft-unlinks every link for a deleted page', async () => {
      vi.mocked(softUnlinkAllByContent).mockResolvedValueOnce(3);

      await expect(handleContentDeleted('42')).resolves.toBe(3);
      expect(vi.mocked(softUnlinkAllByContent)).toHaveBeenCalledWith('42', expect.any(Number));
    });

    it('soft-unlinks every link for a deleted issue', async () => {
      vi.mocked(softUnlinkAllByIssue).mockResolvedValueOnce(2);

      await expect(handleIssueDeleted('ABC-1')).resolves.toBe(2);
    });

    it('ignores malformed identifiers instead of writing', async () => {
      await expect(handleContentDeleted('not-an-id')).resolves.toBe(0);
      await expect(handleIssueDeleted('')).resolves.toBe(0);

      expect(vi.mocked(softUnlinkAllByContent)).not.toHaveBeenCalled();
      expect(vi.mocked(softUnlinkAllByIssue)).not.toHaveBeenCalled();
    });
  });
});
