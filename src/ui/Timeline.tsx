import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { addDays, longDate, money, shortDate } from '../model/format';
import type { Approval } from '../model/progress';
import type { Id, IsoDate, Item, ProjectEvent, ProjectMember, Role } from '../model/types';
import { audienceLabel, isTeamOnly } from '../model/visibility';
import { Badge, Button, Card, Field, Muted, RefLink, RefRow, Row } from './primitives';
import { kindGlyph, space, type, type Palette } from './theme';
import { useStyles, useTheme } from './ThemeContext';

type Props = {
  events: ProjectEvent[];
  items: Item[];
  members: ProjectMember[];
  viewerRole: Role;
  onReply: (eventId: Id, body: string) => Promise<void>;
  onDecide?: (
    approvalId: Id,
    decision: 'approved' | 'changes_requested',
    note?: string,
  ) => Promise<void>;
  /** Contractor only: move a scheduled job. Posts a new schedule entry; the old one stays on the record. */
  onReschedule?: (
    event: Extract<ProjectEvent, { kind: 'schedule' }>,
    newDate: IsoDate,
  ) => Promise<void>;
  /** Current state of every approval, so a request card knows whether it is still live. */
  approvals: Approval[];
  /** Contractor only: answer a change request from its entry — revise the item and ask again. */
  onRevise?: (itemId: Id) => void;
  /** Contractor only: take a pending or change-requested question back. */
  onWithdraw?: (approvalId: Id, note?: string) => Promise<void>;
};

/** Newest first. Every event is a card; replies live under the event they are about. */
export function Timeline({
  events,
  items,
  members,
  viewerRole,
  onReply,
  onDecide,
  onReschedule,
  approvals,
  onRevise,
  onWithdraw,
}: Props) {
  const ordered = [...events].reverse();
  if (ordered.length === 0) return <Muted>Nothing has happened on this project yet.</Muted>;
  return (
    <View style={{ gap: space.md }}>
      {ordered.map((e) => (
        <EventCard
          key={e.id}
          event={e}
          items={items}
          members={members}
          viewerRole={viewerRole}
          onReply={onReply}
          onDecide={onDecide}
          onReschedule={onReschedule}
          approvals={approvals}
          onRevise={onRevise}
          onWithdraw={onWithdraw}
        />
      ))}
    </View>
  );
}

/** The one-line summary of an entry. Anything it names is a link to that thing. */
function Headline({
  e,
  items,
  approvals,
}: {
  e: ProjectEvent;
  items: Item[];
  approvals: Approval[];
}) {
  const item = (id: Id) => {
    const it = items.find((i) => i.id === id);
    return it ? <RefLink to={{ kind: 'item', id }}>{it.name}</RefLink> : <>an item</>;
  };
  switch (e.kind) {
    case 'note':
      return <>{e.body ?? ''}</>;
    case 'milestone':
      return <>{`${e.title} — ${e.status === 'done' ? 'finished' : e.status}`}</>;
    case 'schedule':
      return <>{`${e.title} · ${longDate(e.date)}${e.who ? ` · ${e.who}` : ''}`}</>;
    case 'order':
      return (
        <>
          Ordered {item(e.itemId)}
          {e.expectedDate ? ` · expected ${shortDate(e.expectedDate)}` : ''}
        </>
      );
    case 'delivery':
      return (
        <>
          {item(e.itemId)}
          {`: ${e.received} of ${e.expected} received${e.damaged ? `, ${e.damaged} damaged` : ''}`}
        </>
      );
    case 'approval_requested':
      return (
        <>
          {e.title}
          {e.amount !== undefined ? ` · ${money(e.amount)}` : ''}
          {e.dueBy ? ` · decide by ${shortDate(e.dueBy)}` : ''}
          {e.itemId ? <> · {item(e.itemId)}</> : null}
        </>
      );
    case 'approval_decided': {
      const a = approvals.find((x) => x.approvalId === e.approvalId);
      return (
        <>
          {e.decision === 'approved'
            ? 'Approved'
            : e.decision === 'withdrawn'
              ? 'Withdrew the request'
              : 'Asked for changes'}
          {a ? (
            <>
              {' · '}
              <RefLink to={{ kind: 'event', id: a.requestedEventId }}>{a.title}</RefLink>
            </>
          ) : null}
        </>
      );
    }
    case 'photo':
      return <>{e.caption ?? 'Photo'}</>;
    case 'document_sent':
      return (
        <>{`${e.title} · sent by ${e.via} to ${e.to}${e.layers.length ? ` · layers: ${e.layers.join(', ')}` : ''}`}</>
      );
    case 'dismissal': {
      const verb =
        e.action === 'restore'
          ? 'Brought back'
          : e.action === 'acted'
            ? (e.reason ?? 'Acted on')
            : e.reason?.startsWith('Snoozed')
              ? 'Snoozed'
              : 'Set aside';
      return (
        <>
          {verb}: “{e.title}”
          {e.action !== 'restore' && e.until ? ` · back ${shortDate(e.until)} if still open` : ''}
          {e.action === 'dismiss' && !e.until ? ' · until restored' : ''}
        </>
      );
    }
  }
}

function EventCard({
  event: e,
  items,
  members,
  viewerRole,
  onReply,
  onDecide,
  onReschedule,
  approvals,
  onRevise,
  onWithdraw,
}: Omit<Props, 'events'> & { event: ProjectEvent }) {
  const { tones } = useTheme();
  const styles = useStyles(makeStyles);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveDays, setMoveDays] = useState('7');
  const [changing, setChanging] = useState(false); // "Request changes" note box
  const [withdrawing, setWithdrawing] = useState(false); // contractor's "Withdraw request" note box
  const canMove = e.kind === 'schedule' && viewerRole === 'contractor' && !!onReschedule;
  const k = kindGlyph[e.kind];
  // For a request card: which approval it belongs to, and whether THIS card is the live request.
  const approval =
    e.kind === 'approval_requested'
      ? approvals.find((a) => a.approvalId === e.approvalId)
      : undefined;
  const isCurrentRequest = approval?.requestedEventId === e.id;
  const superseded = e.kind === 'approval_requested' && approval !== undefined && !isCurrentRequest;
  const isPending = isCurrentRequest && approval?.decision === undefined;
  const awaitingContractor = isCurrentRequest && approval?.decision === 'changes_requested';
  const canDecide = isPending && viewerRole === 'homeowner' && !!onDecide;
  // The contractor may answer from the live request, or from the homeowner's change-request entry.
  const changeRequest =
    e.kind === 'approval_decided' && e.decision === 'changes_requested'
      ? approvals.find((a) => a.approvalId === e.approvalId && a.decidedEventId === e.id)
      : undefined;
  const answerable =
    viewerRole === 'contractor'
      ? (changeRequest ?? (isPending || awaitingContractor ? approval : undefined))
      : undefined;

  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await onReply(e.id, draft.trim());
      setDraft('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card focusKey={`event:${e.id}`}>
      <Row style={{ justifyContent: 'space-between' }} wrap>
        <Row>
          <Text style={styles.glyph} accessibilityLabel={k.label}>
            {k.glyph}
          </Text>
          <Text style={styles.kind}>{k.label}</Text>
          <Muted>{shortDate(e.at)}</Muted>
        </Row>
        <Row>
          {viewerRole === 'contractor' ? (
            <Badge
              tone={isTeamOnly(e) ? tones.audience.team : tones.audience.shared}
              text={audienceLabel(e.audience, members)}
            />
          ) : null}
          <Badge tone={tones.role[e.authorRole]} text={e.authorName} />
        </Row>
      </Row>
      <Text style={styles.headline}>
        <Headline e={e} items={items} approvals={approvals} />
      </Text>
      {e.kind !== 'note' && e.body ? <Text style={styles.body}>{e.body}</Text> : null}
      {e.refs && e.refs.length > 0 ? <RefRow refs={e.refs} /> : null}

      {canDecide && e.kind === 'approval_requested' && onDecide !== undefined && !changing ? (
        <Row wrap style={{ marginTop: space.xs }}>
          <Button title="Approve" glyph="✓" onPress={() => onDecide(e.approvalId, 'approved')} />
          <Button
            title="Request changes"
            glyph="↺"
            kind="secondary"
            onPress={() => setChanging(true)}
          />
        </Row>
      ) : null}
      {canDecide && e.kind === 'approval_requested' && onDecide !== undefined && changing ? (
        <View style={{ gap: space.sm }}>
          <Field
            label="What would you like changed?"
            value={draft}
            onChangeText={setDraft}
            multiline
            autoFocus
            placeholder="e.g. Can we see a sample of Warm Gray against the tile first?"
          />
          <Row>
            <Button
              title="Send change request"
              glyph="↺"
              disabled={busy || !draft.trim()}
              onPress={async () => {
                setBusy(true);
                try {
                  await onDecide(e.approvalId, 'changes_requested', draft.trim());
                  setDraft('');
                  setChanging(false);
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button title="Cancel" kind="quiet" onPress={() => setChanging(false)} />
          </Row>
        </View>
      ) : null}
      {isPending && viewerRole === 'contractor' ? <Muted>Waiting on the homeowner.</Muted> : null}
      {awaitingContractor && approval ? (
        <Badge
          tone={tones.itemStatus.changes_requested}
          text={`${approval.decidedBy?.split(' ')[0] ?? 'Homeowner'} asked for changes ${shortDate(approval.decidedAt ?? e.at)} — waiting on ${viewerRole === 'contractor' ? 'you' : 'the contractor'}`}
        />
      ) : null}
      {superseded ? <Muted>Superseded by a revised request.</Muted> : null}
      {answerable && !withdrawing ? (
        <Row wrap style={{ marginTop: space.xs }}>
          {onRevise && answerable.itemId && answerable.decision === 'changes_requested' ? (
            <Button
              title="Revise and ask again"
              glyph="?"
              kind="secondary"
              onPress={() => onRevise(answerable.itemId!)}
            />
          ) : null}
          {onWithdraw ? (
            <Button
              title="Withdraw request"
              glyph="⊘"
              kind="quiet"
              onPress={() => {
                setDraft('');
                setWithdrawing(true);
              }}
            />
          ) : null}
        </Row>
      ) : null}
      {answerable && withdrawing && onWithdraw ? (
        <View style={{ gap: space.sm }}>
          <Field
            label="Withdraw the request — a note to the homeowner (optional)"
            value={draft}
            onChangeText={setDraft}
            multiline
            autoFocus
            placeholder="e.g. We will find another option and ask again."
          />
          <Muted>
            The question closes; the item goes back to Proposed. The request and this note stay on
            the record.
          </Muted>
          <Row>
            <Button
              title="Yes, withdraw"
              glyph="⊘"
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await onWithdraw(answerable.approvalId, draft.trim() || undefined);
                  setDraft('');
                  setWithdrawing(false);
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button title="Cancel" kind="quiet" onPress={() => setWithdrawing(false)} />
          </Row>
        </View>
      ) : null}

      {canMove && moving && e.kind === 'schedule' && onReschedule ? (
        <View style={{ gap: space.sm }}>
          <Field
            label="Move to how many days from today"
            value={moveDays}
            onChangeText={setMoveDays}
            keyboardType="number-pad"
          />
          <Muted>
            New date: {longDate(addDays(new Date().toISOString(), Number(moveDays) || 0))}. The
            original stays on the record so everyone can see it moved.
          </Muted>
          <Row>
            <Button
              title="Confirm new date"
              glyph="◷"
              disabled={busy || Number.isNaN(Number(moveDays))}
              onPress={async () => {
                setBusy(true);
                try {
                  await onReschedule(e, addDays(new Date().toISOString(), Number(moveDays) || 0));
                  setMoving(false);
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button title="Cancel" kind="quiet" onPress={() => setMoving(false)} />
          </Row>
        </View>
      ) : null}

      {e.replies.length > 0 ? (
        <View style={styles.thread}>
          {e.replies.map((r) => (
            <View key={r.id} style={styles.reply}>
              <Row>
                <Badge tone={tones.role[r.authorRole]} text={r.authorName} />
                <Muted>{shortDate(r.at)}</Muted>
              </Row>
              <Text style={styles.body}>{r.body}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {open ? (
        <View style={{ gap: space.sm }}>
          <Field
            label="Reply"
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder="Keep it on this topic — it stays attached to this event."
          />
          <Row>
            <Button title="Send" onPress={send} disabled={busy || !draft.trim()} />
            <Button title="Cancel" kind="quiet" onPress={() => setOpen(false)} />
          </Row>
        </View>
      ) : (
        <Row wrap>
          <Button
            title={e.replies.length ? 'Reply' : 'Ask about this'}
            kind="quiet"
            glyph="↩"
            onPress={() => setOpen(true)}
          />
          {canMove && !moving ? (
            <Button title="Reschedule" kind="quiet" glyph="◷" onPress={() => setMoving(true)} />
          ) : null}
        </Row>
      )}
    </Card>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    glyph: { fontSize: 16, color: p.accent, width: 20, textAlign: 'center' },
    kind: { ...type.small, color: p.ink2, fontWeight: '600' },
    headline: { ...type.body, color: p.ink, fontWeight: '600' },
    body: { ...type.body, color: p.ink2 },
    thread: {
      borderLeftWidth: 2,
      borderLeftColor: p.line,
      paddingLeft: space.md,
      gap: space.sm,
      marginTop: space.xs,
    },
    reply: { gap: 4 },
  });
