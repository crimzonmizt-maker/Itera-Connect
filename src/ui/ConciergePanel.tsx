import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { dismissUntil, mustSnooze, type SuggestionState } from '../concierge/dismissals';
import type { Suggestion } from '../concierge/rules';
import {
  customSnooze,
  maxSnoozeDays,
  snoozeOptions,
  snoozeReason,
  type SnoozeOption,
} from '../concierge/snooze';
import { addDays, shortDate } from '../model/format';
import type { Id, IsoDate, NewEvent, ProjectMember } from '../model/types';
import { audienceLabel } from '../model/visibility';
import { Badge, Button, Card, Field, Muted, RefRow, Row } from './primitives';
import { space, type, type Palette } from './theme';
import { useStyles, useTheme } from './ThemeContext';

/**
 * What the concierge has noticed. It only proposes; the contractor posts or snoozes.
 *
 * There is no Dismiss. A card is paused — for six hours if urgent, else 1 / 3 / 7 or a custom
 * number of days — and the choices are capped by the calendar (`concierge/snooze.ts`): nothing
 * lands on or after the deadline, and a choice inside the day before it asks for a
 * confirmation. The pause is a business-only entry on the record, the card moves to "Set
 * aside" below with a Restore button, and it comes back on its own when the pause runs out.
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
  onReply,
  onRevise,
  onWithdraw,
}: {
  active: SuggestionState[];
  archived: SuggestionState[];
  members: ProjectMember[];
  /** Whose name a sent draft will carry — the signed-in contractor. */
  authorName: string;
  projectId: string;
  now: IsoDate;
  onPost: (event: NewEvent) => Promise<void>;
  /** For change-request cards (`suggestion.respond`): answer without leaving the card. */
  onReply?: (eventId: Id, body: string) => Promise<void>;
  onRevise?: (itemId: Id) => void;
  onWithdraw?: (approvalId: Id, note?: string) => Promise<void>;
}) {
  const styles = useStyles(makeStyles);
  const { tones } = useTheme();
  const [expanded, setExpanded] = useState<string>();
  const [snoozing, setSnoozing] = useState<string>();
  const [customDays, setCustomDays] = useState('');
  const [customError, setCustomError] = useState<string>();
  // A choice that lands inside the buffer before the deadline waits here for a confirmation.
  const [confirming, setConfirming] = useState<{ id: string; option: SnoozeOption }>();
  const [showArchive, setShowArchive] = useState(false);
  const [lastDismissed, setLastDismissed] = useState<Suggestion>();
  const [showAll, setShowAll] = useState(false);
  const [index, setIndex] = useState(0);
  // Change-request cards: which card has its reply / withdraw box open, and its text.
  const [responding, setResponding] = useState<{ id: string; mode: 'reply' | 'withdraw' }>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
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
    snooze?: SnoozeOption,
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
      snooze: snooze
        ? { hours: snooze.hours, days: snooze.days, cutsClose: snooze.cutsClose }
        : undefined,
      audience: [],
    });

  /** Pick a pause. One that cuts close is held for a confirmation first. */
  const pick = (s: Suggestion, option: SnoozeOption) => {
    if (option.cutsClose && confirming?.option.until !== option.until) {
      setConfirming({ id: s.id, option });
      return;
    }
    void snooze(s, option);
  };
  const snooze = async (s: Suggestion, option: SnoozeOption) => {
    await record(s, 'dismiss', option.until, snoozeReason(option, s), option);
    setSnoozing(undefined);
    setConfirming(undefined);
    setCustomDays('');
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
        const options = snoozeOptions(s, now);
        const maxDays = maxSnoozeDays(s, now);
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
            {s.respond && responding?.id === s.id ? (
              <View style={styles.draft}>
                <Field
                  label={
                    responding.mode === 'reply'
                      ? `Reply to ${s.respond.who} — stays attached to the change request`
                      : `Withdraw the request — a note to ${s.respond.who} (optional)`
                  }
                  value={note}
                  onChangeText={setNote}
                  multiline
                  autoFocus
                  placeholder={
                    responding.mode === 'reply'
                      ? 'e.g. Understood — I will bring two other samples Thursday.'
                      : 'e.g. We will find another option and ask again.'
                  }
                />
                <Row wrap>
                  <Button
                    title={responding.mode === 'reply' ? 'Send reply' : 'Yes, withdraw'}
                    glyph={responding.mode === 'reply' ? '↩' : '⊘'}
                    disabled={busy || (responding.mode === 'reply' && !note.trim())}
                    onPress={async () => {
                      setBusy(true);
                      try {
                        if (responding.mode === 'reply')
                          await onReply?.(s.respond!.replyTo, note.trim());
                        else await onWithdraw?.(s.respond!.approvalId, note.trim() || undefined);
                        setResponding(undefined);
                        setNote('');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                  <Button title="Cancel" kind="quiet" onPress={() => setResponding(undefined)} />
                </Row>
              </View>
            ) : null}
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
                  {s.dueBy
                    ? `Due ${shortDate(s.dueBy)}. Pause it until when? The choice goes on the record, and the card comes back on its own.`
                    : 'Pause it until when? The choice goes on the record, and the card comes back on its own.'}
                </Text>
                {confirming?.id === s.id ? (
                  <View style={styles.confirmBox}>
                    <Text style={styles.draftLabel}>
                      ▲ That is inside the day before it is due ({shortDate(s.dueBy!)}). Pause it
                      anyway?
                    </Text>
                    <Row wrap>
                      <Button
                        title={`Yes, pause ${confirming.option.label}`}
                        glyph="◷"
                        onPress={() => void snooze(s, confirming.option)}
                      />
                      <Button title="No" kind="quiet" onPress={() => setConfirming(undefined)} />
                    </Row>
                  </View>
                ) : (
                  <>
                    <Row wrap>
                      {options.map((o) => (
                        <Button
                          key={o.label}
                          title={o.cutsClose ? `${o.label} ▲` : o.label}
                          kind="secondary"
                          glyph="◷"
                          onPress={() => pick(s, o)}
                        />
                      ))}
                      {options.length === 0 ? (
                        <Muted>
                          {pastDue
                            ? 'Past due — nothing to pause; reschedule the date.'
                            : 'Due too soon for a preset pause.'}
                        </Muted>
                      ) : null}
                    </Row>
                    {s.severity !== 'urgent' && (maxDays === undefined || maxDays > 0) ? (
                      <Row wrap style={{ alignItems: 'flex-end' }}>
                        <View style={{ width: 120 }}>
                          <Field
                            label={
                              maxDays === undefined
                                ? 'Custom days'
                                : `Custom days (up to ${maxDays})`
                            }
                            value={customDays}
                            onChangeText={setCustomDays}
                            keyboardType="number-pad"
                          />
                        </View>
                        <Button
                          title="Pause"
                          kind="secondary"
                          glyph="◷"
                          onPress={() => {
                            const r = customSnooze(s, now, Number(customDays));
                            if (r.ok) pick(s, r.option);
                            else setCustomError(r.reason);
                          }}
                        />
                      </Row>
                    ) : null}
                    {customError ? <Text style={styles.error}>{customError}</Text> : null}
                    <Row wrap>
                      <Button
                        title="Cancel"
                        kind="quiet"
                        onPress={() => {
                          setSnoozing(undefined);
                          setCustomError(undefined);
                        }}
                      />
                    </Row>
                  </>
                )}
              </View>
            ) : null}
            <Row wrap>
              {s.respond && responding?.id !== s.id ? (
                <>
                  {onRevise && s.respond.itemId ? (
                    <Button
                      title="Revise and ask again"
                      glyph="?"
                      onPress={() => onRevise(s.respond!.itemId!)}
                    />
                  ) : null}
                  {onReply ? (
                    <Button
                      title={`Reply to ${s.respond.who}`}
                      glyph="↩"
                      kind="secondary"
                      onPress={() => {
                        setNote('');
                        setResponding({ id: s.id, mode: 'reply' });
                      }}
                    />
                  ) : null}
                  {onWithdraw ? (
                    <Button
                      title="Withdraw request"
                      glyph="⊘"
                      kind="quiet"
                      onPress={() => {
                        setNote('');
                        setResponding({ id: s.id, mode: 'withdraw' });
                      }}
                    />
                  ) : null}
                </>
              ) : null}
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
              {snoozing === s.id ? null : (
                <Button
                  title={s.severity === 'urgent' ? 'Pause 6 hours…' : 'Pause…'}
                  kind="quiet"
                  glyph="◷"
                  onPress={() => {
                    setCustomError(undefined);
                    setConfirming(undefined);
                    setSnoozing(s.id);
                  }}
                />
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
    confirmBox: {
      borderWidth: 1,
      borderColor: p.amber,
      borderRadius: 8,
      padding: space.sm,
      gap: 4,
    },
    error: { ...type.small, color: p.ink },
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
