// The concierge, part one: rules that read the event spine and PROPOSE.
//
// Nothing here changes data. Every rule returns Suggestions; a human accepts one, and
// acceptance becomes an ordinary event. Every suggestion cites its sources — the item or
// entries it was computed from — and every note it drafts carries the same references, so
// "which bathtub?" is always one tap away for the reader too. A language model can later
// reword a suggestion or answer a free-text question, but it must be fed these facts and
// cite them the same way, never asked to remember the project.

import { addDays, daysBetween, money, plural, shortDate } from '../model/format';
import { arrivalOf, collisions, expectedOnSite, latestJobs } from '../model/logistics';
import { approvals } from '../model/progress';
import type {
  Id,
  IsoDate,
  Item,
  NewEvent,
  ProjectEvent,
  ProjectMember,
  Ref,
  Role,
} from '../model/types';
import { homeownerIds } from '../model/visibility';

/** Where a suggestion came from. Same shape as a Ref so it can be posted along with a draft. */
export type Source = Ref;

export type Suggestion = {
  id: string;
  severity: 'info' | 'attention' | 'urgent';
  audience: Role; // who should act
  title: string;
  detail: string;
  /** Where this came from. Never empty. */
  source: Source[];
  /** If accepting means posting something, this is the draft event. */
  proposedEvent?: NewEvent;
  /** Button wording for the draft: what the contractor is about to do. Defaults to review/post. */
  action?: { review: string; confirm: string };
  /** The date this stops being a warning and becomes a problem. Past it, dismissing needs a snooze. */
  dueBy?: IsoDate;
  /**
   * Set when the card is a homeowner's change request. The panel offers the contractor the three
   * honest answers — reply, revise and ask again, withdraw — without leaving the card.
   */
  respond?: { approvalId: Id; itemId?: Id; replyTo: Id; who: string };
};

const REMIND = { review: 'Review reminder', confirm: 'Send reminder' };

export type RuleInput = {
  projectId: Id;
  events: ProjectEvent[]; // full, unfiltered — rules run on the contractor's side
  items: Item[];
  members: ProjectMember[];
  now: IsoDate;
};

const itemRef = (item: Item): Ref => ({ kind: 'item', id: item.id, label: item.name });
const eventRef = (id: Id, label: string): Ref => ({ kind: 'event', id, label });

/**
 * Approvals not yet settled.
 *  • waiting on the homeowner: urgent once past dueBy or older than 5 days; a nudge is drafted
 *    once it has sat a while
 *  • the homeowner asked for changes: the contractor's move — revise the item and ask again
 */
export function overdueApprovals({ projectId, events, items, now }: RuleInput): Suggestion[] {
  const out: Suggestion[] = [];
  for (const a of approvals(events)) {
    const request = events.find((e) => e.id === a.requestedEventId);
    const item = a.itemId ? items.find((i) => i.id === a.itemId) : undefined;
    const requestSource = eventRef(
      a.requestedEventId,
      `Approval requested ${shortDate(a.requestedAt)}`,
    );

    if (a.decision === 'changes_requested') {
      out.push({
        id: `changes:${a.approvalId}:${a.round}`,
        severity: daysBetween(a.decidedAt ?? now, now) > 2 ? 'urgent' : 'attention',
        audience: 'contractor',
        title: `${a.decidedBy ?? 'The homeowner'} asked for changes to ${a.title}`,
        detail:
          (a.decisionNote ? `“${a.decisionNote}” · ` : '') +
          `${shortDate(a.decidedAt ?? now)}. Reply, revise the item and ask again, or withdraw the request.`,
        source: [
          ...(item ? [itemRef(item)] : []),
          ...(a.decidedEventId
            ? [eventRef(a.decidedEventId, `Change requested ${shortDate(a.decidedAt ?? now)}`)]
            : []),
          requestSource,
        ],
        // The contractor answers from the card: reply on the change request, revise the item and
        // ask again, or withdraw the question.
        respond: {
          approvalId: a.approvalId,
          itemId: a.itemId,
          replyTo: a.decidedEventId ?? a.requestedEventId,
          who: (a.decidedBy ?? 'the homeowner').split(' ')[0]!,
        },
      });
      continue;
    }
    if (a.decision === 'approved' || a.decision === 'withdrawn') continue;

    const waitingDays = daysBetween(a.requestedAt, now);
    const pastDue = a.dueBy !== undefined && daysBetween(a.dueBy, now) > 0;
    const severity = pastDue || waitingDays > 5 ? 'urgent' : waitingDays > 2 ? 'attention' : 'info';
    // Only offer a nudge once it has been sitting a while; a same-day nudge is noise.
    const nudge: Pick<Suggestion, 'proposedEvent' | 'action'> =
      severity === 'info' || !request
        ? {}
        : {
            action: REMIND,
            proposedEvent: {
              projectId,
              kind: 'note',
              audience: request.audience,
              refs: [...(item ? [itemRef(item)] : []), requestSource],
              body:
                `A reminder — I still need your decision on "${a.title}"` +
                (a.dueBy ? ` (it was due ${shortDate(a.dueBy)})` : '') +
                '. Work waits on it; a quick approve or "request changes" on the entry is all I need.',
            },
          };
    out.push({
      ...nudge,
      id: `approval:${a.approvalId}`,
      severity,
      dueBy: a.dueBy,
      audience: 'homeowner',
      title: `Waiting on homeowner approval: ${a.title}${a.round > 1 ? ` (revised, round ${a.round})` : ''}`,
      detail: [
        a.amount !== undefined ? money(a.amount) : undefined,
        `requested ${shortDate(a.requestedAt)}`,
        a.dueBy ? `${pastDue ? 'was due' : 'due'} ${shortDate(a.dueBy)}` : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
      source: [...(item ? [itemRef(item)] : []), requestSource],
    });
  }
  return out;
}

/**
 * A scheduled job needs an item that will not be on site by then — either it has not been
 * ordered, or it is ordered and lands too late. Uses the same arithmetic as the item cards.
 */
export function leadTimeCollisions({ events, items, members, now }: RuleInput): Suggestion[] {
  const out: Suggestion[] = [];
  const jobRef = (job: { id: Id; title: string; date: IsoDate }) =>
    eventRef(job.id, `${job.title} · ${shortDate(job.date)}`);

  // Not ordered at all.
  for (const job of latestJobs(events)) {
    if (!job.needs || daysBetween(now, job.date) < 0) continue;
    for (const itemId of job.needs) {
      const item = items.find((i) => i.id === itemId);
      if (!item || arrivalOf(item, events).state !== 'not_ordered') continue;
      const lead = item.sourcing?.leadTimeDays;
      const orderBy = lead !== undefined ? shortDate(addDays(job.date, -lead)) : undefined;
      const homeownerBuys = item.purchasedBy === 'homeowner';
      const s = item.sourcing;
      const where = s?.supplier ? ` from ${s.supplier}` : '';
      const part = s?.sku ? ` (SKU ${s.sku})` : '';
      out.push({
        id: `unordered:${job.id}:${itemId}`,
        severity: 'attention',
        dueBy: lead !== undefined ? addDays(job.date, -lead) : job.date,
        audience: 'contractor',
        title: `${item.name} is not ordered but ${job.title} is ${shortDate(job.date)}`,
        detail:
          (orderBy !== undefined
            ? `Lead time is ${lead} days; order by ${orderBy}.`
            : 'No lead time recorded for this item.') +
          (homeownerBuys ? ' The homeowner is buying this one.' : ''),
        source: [itemRef(item), jobRef(job)],
        ...(homeownerBuys
          ? {
              action: REMIND,
              proposedEvent: {
                projectId: job.projectId,
                kind: 'note',
                audience: homeownerIds(members),
                refs: [itemRef(item), jobRef(job)],
                body:
                  `A reminder about ${item.name}: ${job.title} is ${shortDate(job.date)} and this is on your list to buy. ` +
                  (orderBy !== undefined
                    ? `It needs about ${lead} days to arrive, so please order by ${orderBy}`
                    : 'Please order it as soon as you can') +
                  `${where}${part}. Quantity: ${item.quantity} ${plural(item.unit ?? 'unit', item.quantity)}.`,
              },
            }
          : {}),
      });
    }
  }

  // Ordered, but landing after the job.
  for (const c of collisions(items, events, now)) {
    const onSite = expectedOnSite(c.arrival)!;
    const arrivalId = c.arrival.state === 'not_ordered' ? undefined : c.arrival.eventId;
    out.push({
      id: `collision:${c.job.id}:${c.item.id}`,
      severity: c.lateBy > 3 ? 'urgent' : 'attention',
      dueBy: c.job.date,
      audience: 'contractor',
      title: `${c.item.name} arrives ${c.lateBy} day${c.lateBy === 1 ? '' : 's'} after ${c.job.title}`,
      detail: `Expected ${shortDate(onSite)}; ${c.job.title} is scheduled ${shortDate(c.job.date)}${c.job.who ? ` with ${c.job.who}` : ''}. Move the job or expedite the order.`,
      source: [
        itemRef(c.item),
        ...(arrivalId ? [eventRef(arrivalId, `Expected ${shortDate(onSite)}`)] : []),
        jobRef(c.job),
      ],
      proposedEvent: {
        projectId: c.job.projectId,
        kind: 'schedule',
        title: c.job.title,
        date: addDays(onSite, 1),
        who: c.job.who,
        needs: c.job.needs,
        audience: c.job.audience,
        refs: [itemRef(c.item), jobRef(c.job)],
        body: `Rescheduled: ${c.item.name} now expected ${shortDate(onSite)}.`,
      },
    });
  }
  return out;
}

/** Deliveries that came in short or damaged and have not been made whole since. */
export function unresolvedShortfalls({
  projectId,
  events,
  items,
  members,
  now,
}: RuleInput): Suggestion[] {
  const out: Suggestion[] = [];
  for (const item of items) {
    const a = arrivalOf(item, events);
    if (a.state !== 'short') continue;
    const missing = a.expected - (a.received - a.damaged);
    const age = daysBetween(a.at, now);
    const s = item.sourcing;
    const deliveryRef = eventRef(a.eventId, `Delivery ${shortDate(a.at)}`);
    out.push({
      id: `shortfall:${item.id}`,
      severity: age > 3 ? 'urgent' : 'attention',
      audience: 'contractor',
      title: `${item.name} is ${missing} ${plural(item.unit ?? 'unit', missing)} short`,
      detail:
        `${a.received - a.damaged} of ${a.expected} usable${a.damaged ? `, ${a.damaged} damaged` : ''}. Last delivery ${shortDate(a.at)}${s?.supplier ? ` from ${s.supplier}` : ''}${s?.orderNumber ? ` (order ${s.orderNumber})` : ''}.` +
        (item.purchasedBy === 'homeowner' ? ' The homeowner placed this order.' : ''),
      source: [itemRef(item), deliveryRef],
      ...(item.purchasedBy === 'homeowner'
        ? {
            action: REMIND,
            proposedEvent: {
              projectId,
              kind: 'note',
              audience: homeownerIds(members),
              refs: [itemRef(item), deliveryRef],
              body:
                `About your ${item.name} order: ${a.received} of ${a.expected} arrived${a.damaged ? ` (${a.damaged} damaged)` : ''}, so we are ${missing} ${plural(item.unit ?? 'unit', missing)} short. ` +
                `Could you ask ${s?.supplier ?? 'the supplier'} for the rest${s?.orderNumber ? ` — order ${s.orderNumber}` : ''}? Installation needs the full count.`,
            },
          }
        : {}),
    });
  }
  return out;
}

/**
 * A draft weekly update for ONE homeowner, built only from the entries THEY can see in the
 * window. Each line carries a reference to the entry it summarises, so the posted update is
 * a list of links, not a wall of text. The contractor reads it, edits it, and posts it.
 */
export function weeklyDigest(
  { projectId, events, items, members, now }: RuleInput,
  homeownerId: Id,
  since: IsoDate = addDays(now, -7),
): Suggestion | undefined {
  const person = members.find((m) => m.userId === homeownerId);
  if (!person) return undefined;
  const window = events.filter(
    (e) =>
      e.audience.includes(homeownerId) &&
      daysBetween(since, e.at) >= 0 &&
      daysBetween(e.at, now) >= 0,
  );
  if (window.length === 0) return undefined;
  const lines: string[] = [];
  const refs: Ref[] = [];
  const itemName = (id: Id) => items.find((i) => i.id === id)?.name ?? 'an item';
  for (const e of window) {
    let line: string | undefined;
    switch (e.kind) {
      case 'milestone':
        line = `${e.title}: ${e.status === 'done' ? 'finished' : e.status}${e.body ? ` — ${e.body}` : ''}`;
        break;
      case 'schedule':
        line = `${e.title} scheduled for ${shortDate(e.date)}${e.who ? ` (${e.who})` : ''}`;
        break;
      case 'order':
        line = `Ordered ${itemName(e.itemId)}${e.expectedDate ? `, expected ${shortDate(e.expectedDate)}` : ''}`;
        break;
      case 'approval_decided':
        line =
          e.decision === 'withdrawn'
            ? `We withdrew a request for your approval${e.body ? ` — ${e.body}` : ''}`
            : `You ${e.decision === 'approved' ? 'approved' : 'asked for changes to'} an item — thank you`;
        break;
      case 'approval_requested':
        line = `Still needs your decision: ${e.title}`;
        break;
      case 'photo':
        line = `New photo${e.caption ? `: ${e.caption}` : ''}`;
        break;
      case 'delivery':
        line = `${itemName(e.itemId)} delivered`;
        break;
      case 'document_sent':
        line = `Sent you ${e.title} by ${e.via}`;
        break;
      case 'note':
      case 'dismissal':
        break; // notes are already conversation; dismissals never reach a homeowner anyway
    }
    if (line) {
      lines.push(`• ${line}`);
      refs.push(eventRef(e.id, line));
    }
  }
  if (lines.length === 0) return undefined;
  const first = person.displayName.split(' ')[0];
  return {
    id: `digest:${homeownerId}:${since.slice(0, 10)}`,
    severity: 'info',
    audience: 'contractor',
    title: `Weekly update for ${first} is ready to review`,
    detail: `${lines.length} item${lines.length === 1 ? '' : 's'} since ${shortDate(since)}, from entries ${first} can see.`,
    source: refs,
    proposedEvent: {
      projectId,
      kind: 'note',
      audience: [homeownerId],
      refs,
      body: `This week on your project:\n${lines.join('\n')}`,
    },
  };
}

const order: Record<Suggestion['severity'], number> = { urgent: 0, attention: 1, info: 2 };

/** Everything the concierge has to say right now, most urgent first. */
export function allSuggestions(input: RuleInput): Suggestion[] {
  const digests = homeownerIds(input.members)
    .map((id) => weeklyDigest(input, id))
    .filter((d): d is Suggestion => d !== undefined);
  return [
    ...overdueApprovals(input),
    ...leadTimeCollisions(input),
    ...unresolvedShortfalls(input),
    ...digests,
  ].sort((a, b) => order[a.severity] - order[b.severity]);
}
