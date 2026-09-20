import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { dismissUntil, mustSnooze, type SuggestionState } from '../concierge/dismissals';
import type { Suggestion } from '../concierge/rules';
import { addDays, shortDate } from '../model/format';
import type { IsoDate, NewEvent, ProjectMember } from '../model/types';
import { audienceLabel } from '../model/visibility';
import { Badge, Button, Card, Muted, RefRow, Row } from './primitives';
import { space, type, type Palette } from './theme';
import { useStyles, useTheme } from './ThemeContext';

/**
 * What the concierge has noticed. It only proposes; the contractor posts, dismisses or snoozes.
 *
 * Dismissing is not deleting. It posts a business-only entry on the record, the card moves to
 * "Set aside" below with a Restore button, and — depending on how loud it was — it comes back
 * on its own: urgent the next day, attention after three, info only when restored. On or after
 * its due date a card cannot be plainly dismissed; the contractor picks a snooze instead.
 *
 * Cards show one at a time — a summary strip ("2 urgent · 3 to look at · 2 for information"),
 * then ‹ 1 of 7 › — so a busy project does not open onto a wall of warnings. "Show all" lays
 * them out as a list for a review pass.
 */
export function ConciergePanel({
  active,
  archived,
  members,
  authorName,
  projectId,
  now,
  onPost,
}: {
  active: SuggestionState[];
  archived: SuggestionState[];
  members: ProjectMember[];
  /** Whose name a sent draft will carry — the signed-in contractor. */
  authorName: string;
  projectId: string;
  now: IsoDate;
  onPost: (event: NewEvent) => Promise<void>;
}) {
  const styles = useStyles(makeStyles);
  const { tones } = useTheme();
  const [expanded, setExpanded] = useState<string>();
  const [snoozing, setSnoozing] = useState<string>();
  const [showArchive, setShowArchive] = useState(false);
  const [lastDismissed, setLastDismissed] = useState<Suggestion>();
  const [showAll, setShowAll] = useState(false);
  const [index, setIndex] = useState(0);
  // The list shrinks when a card is dismissed or resolved; never point past the end.
  useEffect(() => {
    if (index > active.length - 1) setIndex(Math.max(0, active.length - 1));
  }, [active.length, index]);
  const counts = {
    urgent: active.filter((x) => x.suggestion.severity === 'urgent').length,
    attention: active.filter((x) => x.suggestion.severity === 'attention').length,
    info: active.filter((x) => x.suggestion.severity === 'info').length,
  };
  const shown = showAll ? active : active.slice(index, index + 1);

  const record = (
    s: Suggestion,
    action: 'dismiss' | 'restore' | 'acted',
    until?: IsoDate,
    reason?: string,
  ) =>
    onPost({
      projectId,
      kind: 'dismissal',
      suggestionId: s.id,
      title: s.title,
      severity: s.severity,
      action,
      until,
      reason,
      audience: [],
    });

  const dismiss = async (s: Suggestion) => {
    await record(s, 'dismiss', dismissUntil(s, now));
    setLastDismissed(s);
  };
  const snooze = async (s: Suggestion, days: number) => {
    await record(
      s,
      'dismiss',
      addDays(now, days),
      `Snoozed ${days} day${days === 1 ? '' : 's'} past its due date`,
    );
    setSnoozing(undefined);
    setLastDismissed(s);
  };
  const restore = async (s: Suggestion) => {
    await record(s, 'restore');
    if (lastDismissed?.id === s.id) setLastDismissed(undefined);
  };
  const acted = async (s: Suggestion) => {
    await onPost(s.proposedEvent!);
    // The draft went out; set the card aside on the same terms as a dismissal so it comes back
    // if the underlying problem is still there.
    await record(
      s,
      'acted',
      dismissUntil(s, now) ?? addDays(now, 7),
      s.action?.confirm ?? 'Posted',
    );
    setExpanded(undefined);
  };

  return (
    <View style={{ gap: space.sm }}>
      {lastDismissed ? (
        <Row wrap style={styles.undoBar}>
          <Muted>Set aside: {lastDismissed.title}</Muted>
          <Button title="Undo" kind="quiet" glyph="↶" onPress={() => void restore(lastDismissed)} />
        </Row>
      ) : null}

      {active.length === 0 ? <Muted>Nothing needs attention right now.</Muted> : null}
      {active.length > 0 ? (
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Row wrap>
            {counts.urgent ? (
              <Badge tone={tones.severity.urgent} text={`${counts.urgent} urgent`} />
            ) : null}
            {counts.attention ? (
              <Badge tone={tones.severity.attention} text={`${counts.attention} to look at`} />
            ) : null}
            {counts.info ? (
              <Badge tone={tones.severity.info} text={`${counts.info} for information`} />
            ) : null}
          </Row>
          <Row>
            {!showAll && active.length > 1 ? (
              <>
                <Button
                  title="Previous"
                  glyph="‹"
                  kind="quiet"
                  disabled={index === 0}
                  onPress={() => setIndex((i) => Math.max(0, i - 1))}
                />
                <Text
                  style={styles.pager}
                  accessibilityLabel={`Card ${index + 1} of ${active.length}`}
                >
                  {index + 1} of {active.length}
                </Text>
                <Button
                  title="Next"
                  glyph="›"
                  kind="quiet"
                  disabled={index >= active.length - 1}
                  onPress={() => setIndex((i) => Math.min(active.length - 1, i + 1))}
                />
              </>
            ) : null}
            {active.length > 1 ? (
              <Button
                title={showAll ? 'One at a time' : 'Show all'}
                kind="quiet"
                glyph={showAll ? '▭' : '☰'}
                onPress={() => setShowAll((v) => !v)}
              />
            ) : null}
          </Row>
        </Row>
      ) : null}
      {shown.map(({ suggestion: s, timesDismissed, last }) => {
        const tone = tones.severity[s.severity];
        const open = expanded === s.id;
        const pastDue = mustSnooze(s, now);
        return (
          <Card key={s.id} tone={tone} style={{ gap: 6 }} focusKey={`suggestion:${s.id}`}>
            <Row wrap>
              <Badge tone={tone} />
              <Badge
                tone={tones.role[s.audience]}
                text={s.audience === 'homeowner' ? 'Homeowner to act' : 'You to act'}
              />
              {timesDismissed > 0 ? (
                <Badge
                  tone={tones.severity.attention}
                  text={`Back again — set aside ${timesDismissed}× (last ${shortDate(last?.at ?? now)})`}
                />
              ) : null}
              {pastDue && s.dueBy ? (
                <Badge tone={tones.severity.urgent} text={`Due ${shortDate(s.dueBy)}`} />
              ) : null}
            </Row>
            <Text style={styles.title}>{s.title}</Text>
            <Text style={styles.detail}>{s.detail}</Text>
            <RefRow refs={s.source} label="From" />
            {s.proposedEvent && open ? (
              <View style={styles.draft}>
                <Text style={styles.draftLabel}>
                  Draft — {audienceLabel(s.proposedEvent.audience, members)} · will show as sent by{' '}
                  {authorName}
                </Text>
                <Text style={styles.draftBody}>{s.proposedEvent.body}</Text>
              </View>
            ) : null}
            {snoozing === s.id ? (
              <View style={styles.draft}>
                <Text style={styles.draftLabel}>
                  This is due{s.dueBy ? ` ${shortDate(s.dueBy)}` : ''}. Dismissing is off; pick how
                  long to put it off — that choice goes on the record.
                </Text>
                <Row wrap>
                  {[1, 3, 7].map((d) => (
                    <Button
                      key={d}
                      title={`${d} day${d === 1 ? '' : 's'}`}
                      kind="secondary"
                      glyph="◷"
                      onPress={() => void snooze(s, d)}
                    />
                  ))}
                  <Button title="Cancel" kind="quiet" onPress={() => setSnoozing(undefined)} />
                </Row>
              </View>
            ) : null}
            <Row wrap>
              {s.proposedEvent ? (
                open ? (
                  <Button
                    title={s.action?.confirm ?? 'Post to project'}
                    glyph="↑"
                    onPress={() => void acted(s)}
                  />
                ) : (
                  <Button
                    title={s.action?.review ?? 'Review draft'}
                    glyph={s.action ? '✉' : undefined}
                    kind="secondary"
                    onPress={() => setExpanded(s.id)}
                  />
                )
              ) : null}
              {pastDue ? (
                snoozing === s.id ? null : (
                  <Button
                    title="Snooze…"
                    kind="quiet"
                    glyph="◷"
                    onPress={() => setSnoozing(s.id)}
                  />
                )
              ) : (
                <Button title="Dismiss" kind="quiet" onPress={() => void dismiss(s)} />
              )}
            </Row>
          </Card>
        );
      })}

      {archived.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Row wrap style={{ justifyContent: 'space-between' }}>
            <Muted>
              Set aside: {archived.length} — nothing is deleted; each one is on the record.
            </Muted>
            <Button
              title={showArchive ? 'Hide' : 'Show'}
              kind="quiet"
              glyph={showArchive ? '▾' : '▸'}
              onPress={() => setShowArchive((v) => !v)}
            />
          </Row>
          {showArchive
            ? archived.map(({ suggestion: s, last, returnsAt, timesDismissed }) => (
                <Card key={s.id} style={styles.archivedCard}>
                  <Text style={styles.archivedTitle}>{s.title}</Text>
                  <Muted>
                    {last?.action === 'acted' ? (last.reason ?? 'Acted on') : 'Dismissed'}{' '}
                    {shortDate(last?.at ?? now)}
                    {timesDismissed > 1 ? ` · ${timesDismissed}× so far` : ''}
                    {last?.reason && last.action !== 'acted' ? ` · ${last.reason}` : ''}
                    {returnsAt
                      ? ` · comes back ${shortDate(returnsAt)} if still open`
                      : ' · stays away until restored'}
                  </Muted>
                  <Row>
                    <Button
                      title="Restore"
                      kind="quiet"
                      glyph="↶"
                      onPress={() => void restore(s)}
                    />
                  </Row>
                </Card>
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    title: { ...type.body, fontWeight: '600', color: p.ink },
    detail: { ...type.small, color: p.ink2 },
    draft: { backgroundColor: p.panelAlt, borderRadius: 8, padding: space.md, gap: 4 },
    draftLabel: { ...type.label, color: p.ink3 },
    draftBody: { ...type.small, color: p.ink },
    undoBar: {
      justifyContent: 'space-between',
      backgroundColor: p.panelAlt,
      borderRadius: 8,
      paddingHorizontal: space.md,
      paddingVertical: 4,
    },
    archivedCard: { backgroundColor: p.panelAlt, gap: 4 },
    pager: { ...type.small, color: p.ink2, fontVariant: ['tabular-nums'], paddingHorizontal: 4 },
    archivedTitle: { ...type.small, fontWeight: '600', color: p.ink2 },
  });
