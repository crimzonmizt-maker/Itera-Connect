import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { money, shortDate } from '../model/format';
import { arrivalOf, collisionFor, expectedOnSite, type Arrival } from '../model/logistics';
import type { Approval } from '../model/progress';
import type { IsoDate, Item, Project, ProjectEvent, Role } from '../model/types';
import { priceVisibleToHomeowner, sourcingVisibleToHomeowner } from '../model/visibility';
import { Badge, Button, Card, Muted, RefLink, Row } from './primitives';
import { space, type, type Palette } from './theme';
import { useStyles, useTheme } from './ThemeContext';

/**
 * The same items, two views. The homeowner's copy arrives already redacted — no `team`,
 * and `clientPrice` / `sourcing` only where the buyer or the contractor's sharing flags
 * allow — so this component has nothing to hide. It only renders what it was given.
 *
 * Three blocks per item:
 *   header    name, status, who buys it                    — everyone
 *   sourcing  supplier, SKU, order #, lead time            — whoever has to go and buy it
 *   team      supplier cost / margin, private note         — contractor only (never leaves the server)
 * Plus a "where is it" line — ordered / expected / delivered — read off the event spine with
 * the same arithmetic the concierge uses, and a warning when it lands after the job that needs it.
 */
export function ItemsTable({
  items,
  events,
  approvals,
  project,
  viewerRole,
  now,
  onEdit,
  onRequestApproval,
}: {
  items: Item[];
  events: ProjectEvent[];
  approvals: Approval[];
  project: Pick<Project, 'showPrices'>;
  viewerRole: Role;
  now: IsoDate;
  /** Contractor only: opens the item in the form. */
  onEdit?: (item: Item) => void;
  /** Contractor only: ask the homeowner to approve this item (or ask again after changes). */
  onRequestApproval?: (item: Item) => void;
}) {
  const { tones } = useTheme();
  const styles = useStyles(makeStyles);
  if (items.length === 0)
    return (
      <Muted>
        {viewerRole === 'contractor'
          ? 'No items yet. Add the first one — a vanity, the tile, anything the job needs.'
          : 'No selections yet.'}
      </Muted>
    );
  const priced = items.filter((i) => i.clientPrice !== undefined);
  const total = priced.reduce((sum, i) => sum + (i.clientPrice ?? 0), 0);
  const hidden = items.length - priced.length;
  return (
    <View style={{ gap: space.sm }}>
      {items.map((item) => {
        const arrival = arrivalOf(item, events);
        const collision = collisionFor(item, events, now);
        const approval = approvals.find((a) => a.itemId === item.id && a.decision !== 'approved');
        const canAsk =
          onRequestApproval &&
          viewerRole === 'contractor' &&
          (item.status === 'proposed' || item.status === 'changes_requested') &&
          !(approval && approval.decision === undefined); // one live request at a time
        return (
          <Card key={item.id} style={{ gap: 6 }} focusKey={`item:${item.id}`}>
            <Row style={{ justifyContent: 'space-between' }} wrap>
              <Text style={styles.name}>{item.name}</Text>
              <Row wrap>
                <Badge tone={tones.itemStatus[item.status]} />
                {canAsk ? (
                  <Button
                    title={item.status === 'changes_requested' ? 'Ask again' : 'Ask for approval'}
                    kind="quiet"
                    glyph="?"
                    onPress={() => onRequestApproval(item)}
                  />
                ) : null}
                {onEdit && viewerRole === 'contractor' ? (
                  <Button title="Edit" kind="quiet" glyph="✎" onPress={() => onEdit(item)} />
                ) : null}
              </Row>
            </Row>
            {approval ? (
              <Muted>
                {approval.decision === 'changes_requested'
                  ? `${approval.decidedBy?.split(' ')[0] ?? 'Homeowner'} asked for changes ${shortDate(approval.decidedAt ?? now)}${approval.decisionNote ? `: “${approval.decisionNote}”` : ''} · `
                  : `Approval requested ${shortDate(approval.requestedAt)}${approval.dueBy ? `, decide by ${shortDate(approval.dueBy)}` : ''} · `}
                <RefLink
                  to={{ kind: 'event', id: approval.decidedEventId ?? approval.requestedEventId }}
                >
                  open
                </RefLink>
              </Muted>
            ) : null}
            <ArrivalLine arrival={arrival} collision={collision} item={item} />
            <Row wrap style={{ gap: space.lg }}>
              <Muted>
                {item.quantity} {item.unit ?? ''}
              </Muted>
              {item.room ? <Muted>{item.room}</Muted> : null}
              <Badge tone={tones.purchaser[item.purchasedBy]} />
              {item.clientPrice !== undefined ? (
                <Text style={styles.price}>{money(item.clientPrice)}</Text>
              ) : viewerRole === 'homeowner' ? (
                <Muted>Included in your contract</Muted>
              ) : null}
            </Row>

            {item.sourcing ? (
              <View style={styles.sourcing}>
                <Text style={styles.sourcingLabel}>{sourcingLabel(item, viewerRole)}</Text>
                <Row wrap style={{ gap: space.lg }}>
                  {item.sourcing.supplier ? <Cell k="Supplier" v={item.sourcing.supplier} /> : null}
                  {item.sourcing.sku ? <Cell k="SKU" v={item.sourcing.sku} mono /> : null}
                  {item.sourcing.orderNumber ? (
                    <Cell k="Order #" v={item.sourcing.orderNumber} mono />
                  ) : null}
                  {item.sourcing.leadTimeDays !== undefined ? (
                    <Cell k="Lead time" v={`${item.sourcing.leadTimeDays} days`} />
                  ) : null}
                </Row>
              </View>
            ) : null}

            {item.team ? (
              <View style={styles.team}>
                <Text style={styles.teamLabel}>
                  ◈ Your business only — not shown to the homeowner
                </Text>
                <Row wrap style={{ gap: space.lg }}>
                  {item.team.supplierCost !== undefined ? (
                    <Cell
                      k="Cost / margin"
                      v={
                        item.clientPrice !== undefined
                          ? `${money(item.team.supplierCost)} / ${money(item.clientPrice - item.team.supplierCost)}`
                          : money(item.team.supplierCost)
                      }
                    />
                  ) : null}
                  {viewerRole === 'contractor' ? (
                    <Cell
                      k="Homeowner sees price"
                      v={
                        item.clientPrice === undefined
                          ? 'no price set'
                          : priceVisibleToHomeowner(project, item)
                            ? 'yes'
                            : 'no'
                      }
                    />
                  ) : null}
                  {viewerRole === 'contractor' ? (
                    <Cell
                      k="Homeowner sees supplier & SKU"
                      v={
                        !item.sourcing
                          ? 'nothing entered'
                          : sourcingVisibleToHomeowner(item)
                            ? 'yes'
                            : 'no'
                      }
                    />
                  ) : null}
                </Row>
                {item.team.note ? <Text style={styles.note}>{item.team.note}</Text> : null}
              </View>
            ) : null}
          </Card>
        );
      })}
      <Row style={{ justifyContent: 'flex-end', gap: space.md }} wrap>
        <Muted>
          {viewerRole === 'homeowner' ? 'Your total for the priced selections' : 'Client total'}
          {hidden > 0 && viewerRole === 'homeowner' ? ` (${hidden} included in contract)` : ''}
        </Muted>
        <Text style={styles.total}>{money(total)}</Text>
      </Row>
    </View>
  );
}

/** "Ordered Sep 1 · expected Oct 13", with a warning when that lands after the job needing it. */
function ArrivalLine({
  arrival,
  collision,
  item,
}: {
  arrival: Arrival;
  collision: ReturnType<typeof collisionFor>;
  item: Item;
}) {
  const { tones } = useTheme();
  const styles = useStyles(makeStyles);
  if (arrival.state === 'not_ordered') return null;
  const onSite = expectedOnSite(arrival);
  let text: React.ReactNode;
  if (arrival.state === 'ordered')
    text = (
      <>
        Ordered {shortDate(arrival.orderedAt)}
        {onSite ? ` · expected ${shortDate(onSite)}` : ' · no expected date yet'} ·{' '}
        <RefLink to={{ kind: 'event', id: arrival.eventId }}>order entry</RefLink>
      </>
    );
  else if (arrival.state === 'delivered')
    text = (
      <>
        Delivered {shortDate(arrival.at)} · {arrival.received} of {arrival.expected} ·{' '}
        <RefLink to={{ kind: 'event', id: arrival.eventId }}>delivery</RefLink>
      </>
    );
  else
    text = (
      <>
        Delivered {shortDate(arrival.at)} — {arrival.received - arrival.damaged} of{' '}
        {arrival.expected} usable{arrival.damaged ? `, ${arrival.damaged} damaged` : ''} ·{' '}
        <RefLink to={{ kind: 'event', id: arrival.eventId }}>delivery</RefLink>
      </>
    );
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.arrival}>{text}</Text>
      {collision ? (
        <Row wrap>
          <Badge
            tone={tones.severity.attention}
            text={`Arrives ${collision.lateBy} day${collision.lateBy === 1 ? '' : 's'} after it is needed`}
          />
          <Muted>
            <RefLink to={{ kind: 'event', id: collision.job.id }}>
              {collision.job.title} · {shortDate(collision.job.date)}
            </RefLink>{' '}
            needs this {item.name.length > 30 ? 'item' : ''}
          </Muted>
        </Row>
      ) : null}
    </View>
  );
}

/** The sourcing block's heading tells the reader what it is for, in their own terms and tense. */
function sourcingLabel(item: Item, viewerRole: Role): string {
  if (item.purchasedBy !== 'homeowner') return '⇢ Sourcing';
  const ordered =
    item.status === 'ordered' || item.status === 'delivered' || item.status === 'installed';
  if (viewerRole === 'homeowner')
    return ordered ? '⌂ Sourcing — you ordered this' : '⌂ Sourcing — for you to order';
  return ordered ? '⌂ Sourcing — homeowner ordered this' : '⌂ Sourcing — homeowner orders';
}

function Cell({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <View>
      <Text style={styles.cellK}>{k}</Text>
      <Text style={[styles.cellV, mono && type.mono]}>{v}</Text>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    name: { ...type.body, fontWeight: '600', color: p.ink, flexShrink: 1 },
    price: { ...type.body, color: p.ink, fontVariant: ['tabular-nums'] },
    sourcing: {
      backgroundColor: p.slateSoft,
      borderRadius: 8,
      padding: space.md,
      gap: 6,
      marginTop: 4,
    },
    sourcingLabel: { ...type.label, color: p.ink2 },
    arrival: { ...type.small, color: p.ink2 },
    team: {
      backgroundColor: p.amberSoft,
      borderRadius: 8,
      padding: space.md,
      gap: 6,
      marginTop: 4,
    },
    teamLabel: { ...type.label, color: p.amber },
    cellK: { ...type.label, color: p.ink3, fontSize: 10 },
    cellV: { ...type.small, color: p.ink },
    note: { ...type.small, color: p.ink2, fontStyle: 'italic' },
    total: { ...type.h2, color: p.ink, fontVariant: ['tabular-nums'] },
  });
