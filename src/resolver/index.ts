import Resolver from '@forge/resolver';
import {
  getBylineView,
  getIssuePanelView,
  getLinkTransitionHistory,
  linkContentToTicket,
  unlinkContentFromTicket,
  updateLinkStatus
} from '../backend/services/linkService';
import { searchConfluenceContent } from '../backend/services/confluenceService';
import { toAppErrorEnvelope, type AppEnvelope } from '../shared/appError';
import type {
  ContentPayload,
  LinkContentPayload,
  LinkTransitionHistoryPayload,
  SearchPayload,
  TicketPayload,
  UnlinkContentPayload,
  UpdateLinkStatusPayload
} from '../backend/types/contracts';

/**
 * Resolver surface for both UI modules.
 *
 * Two deliberate design choices:
 *
 *  1. **Endpoints are shaped around views, not tables.** `getBylineView` and `getIssuePanelView`
 *     each return everything their panel renders, so a panel loads in one round trip. Composing
 *     on the backend also avoids the trap of the frontend re-requesting data the permission
 *     check had already fetched.
 *
 *  2. **Every definition returns an envelope.** `handle` below wraps the result in
 *     `{ ok: true, data }` or `{ ok: false, code, message }`. Plain objects always survive the
 *     `invoke` bridge, whereas a thrown Error's message and custom fields may not - so the UI
 *     can rely on `code` instead of pattern-matching error text.
 *
 * All validation, permission filtering and workflow enforcement lives in the service layer.
 */

const resolver = new Resolver();

/** The shape Forge hands to every resolver definition. */
interface ResolverRequest<TPayload> {
  payload: TPayload;
  context?: { accountId?: string };
}

/** Passes accountId through only when present, to satisfy exactOptionalPropertyTypes. */
const withAccountId = <TPayload>({ payload, context }: ResolverRequest<TPayload>) => ({
  payload,
  ...(context?.accountId ? { contextAccountId: context.accountId } : {})
});

/**
 * Runs a service call and normalises both outcomes into the envelope.
 *
 * The full error is logged here, but only a code and a safe message cross the bridge - an
 * unexpected exception can carry SQL fragments or internal ids we do not want in the browser.
 */
const handle = async <TData>(name: string, run: () => Promise<TData>): Promise<AppEnvelope<TData>> => {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    console.error(`Resolver '${name}' failed`, error);
    return toAppErrorEnvelope(error);
  }
};

resolver.define('linkContentToTicket', async (request: ResolverRequest<LinkContentPayload>) => {
  return handle('linkContentToTicket', () => linkContentToTicket(withAccountId(request)));
});

resolver.define('unlinkContentFromTicket', async (request: ResolverRequest<UnlinkContentPayload>) => {
  return handle('unlinkContentFromTicket', () => unlinkContentFromTicket(withAccountId(request)));
});

resolver.define('updateLinkStatus', async (request: ResolverRequest<UpdateLinkStatusPayload>) => {
  return handle('updateLinkStatus', () => updateLinkStatus(withAccountId(request)));
});

resolver.define('getLinkTransitionHistory', async (request: ResolverRequest<LinkTransitionHistoryPayload>) => {
  return handle('getLinkTransitionHistory', () => getLinkTransitionHistory(withAccountId(request)));
});

resolver.define('getBylineView', async (request: ResolverRequest<ContentPayload>) => {
  return handle('getBylineView', () => getBylineView(withAccountId(request)));
});

resolver.define('getIssuePanelView', async (request: ResolverRequest<TicketPayload>) => {
  return handle('getIssuePanelView', () => getIssuePanelView(withAccountId(request)));
});

resolver.define('searchConfluenceContent', async ({ payload }: ResolverRequest<SearchPayload>) => {
  return handle('searchConfluenceContent', () => searchConfluenceContent({ payload }));
});

export const handler = resolver.getDefinitions();
