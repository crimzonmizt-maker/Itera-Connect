import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Milestone, Progress } from '../model/progress';
import { Button, Field, Muted, Row } from './primitives';
import { radius, space, type, type Palette } from './theme';
import { useStyles, useTheme } from './ThemeContext';

/**
 * Percent + count + the current milestone. Number and words carry the meaning; the bar is decoration.
 * With `onAdvance` (contractor only) each milestone gets Start / Update / Done — no retyping.
 * Update posts a short note under the milestone without changing its status.
 */
export function ProgressBar({
  progress,
  onAdvance,
}: {
  progress: Progress;
  onAdvance?: (milestone: Milestone, status: Milestone['status'], body?: string) => Promise<void>;
}) {
  const { palette: p } = useTheme();
  const styles = useStyles(makeStyles);
  const [updating, setUpdating] = useState<string>(); // milestone title with the note box open
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (m: Milestone, status: Milestone['status'], body?: string) => {
    if (!onAdvance) return;
    setBusy(true);
    try {
      await onAdvance(m, status, body);
      setUpdating(undefined);
      setNote('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }} wrap>
        <Text style={styles.big}>{progress.percent}%</Text>
        <Muted>
          {progress.done} of {progress.total} milestones finished
        </Muted>
      </Row>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: progress.percent }}
      >
        <View style={[styles.fill, { width: `${progress.percent}%` }]} />
      </View>
      {progress.current ? (
        <Text style={styles.current}>
          Now: <Text style={{ fontWeight: '600' }}>{progress.current.title}</Text>
          {progress.current.status === 'started' ? ' (in progress)' : ' (next up)'}
        </Text>
      ) : null}
      <View style={styles.steps}>
        {progress.milestones.map((m) => (
          <View key={m.title} style={{ gap: 4 }}>
            <Row style={{ gap: 6, justifyContent: 'space-between' }} wrap>
              <Row style={{ gap: 6 }}>
                <Text style={[styles.stepGlyph, m.status === 'done' && { color: p.accent }]}>
                  {m.status === 'done' ? '■' : m.status === 'started' ? '◪' : '□'}
                </Text>
                <Text style={[styles.step, m.status === 'done' && { color: p.ink3 }]}>
                  {m.title}
                  {m.status === 'started' ? ' — in progress' : ''}
                </Text>
              </Row>
              {onAdvance && m.status !== 'done' ? (
                <Row>
                  {m.status === 'planned' ? (
                    <Button
                      title="Start"
                      glyph="▶"
                      kind="quiet"
                      disabled={busy}
                      onPress={() => void send(m, 'started')}
                    />
                  ) : null}
                  <Button
                    title="Update"
                    glyph="✎"
                    kind="quiet"
                    disabled={busy}
                    onPress={() => {
                      setUpdating(updating === m.title ? undefined : m.title);
                      setNote('');
                    }}
                  />
                  <Button
                    title="Done"
                    glyph="✓"
                    kind="quiet"
                    disabled={busy}
                    onPress={() => void send(m, 'done')}
                  />
                </Row>
              ) : null}
            </Row>
            {updating === m.title ? (
              <View style={styles.updateBox}>
                <Field
                  label={`Update on ${m.title}`}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  autoFocus
                  placeholder="e.g. Walls done, floor goes in tomorrow. Status stays as it is."
                />
                <Row>
                  <Button
                    title="Post update"
                    glyph="↑"
                    disabled={busy || !note.trim()}
                    onPress={() => void send(m, m.status, note.trim())}
                  />
                  <Button title="Cancel" kind="quiet" onPress={() => setUpdating(undefined)} />
                </Row>
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    big: { ...type.h1, color: p.ink, fontVariant: ['tabular-nums'] },
    track: {
      height: 10,
      borderRadius: radius.pill,
      backgroundColor: p.panelAlt,
      overflow: 'hidden',
    },
    fill: { height: '100%', backgroundColor: p.accent, borderRadius: radius.pill },
    current: { ...type.body, color: p.ink2 },
    steps: { gap: 4, marginTop: space.xs },
    updateBox: {
      backgroundColor: p.panelAlt,
      borderRadius: 8,
      padding: space.md,
      gap: space.sm,
      marginLeft: 22,
    },
    stepGlyph: { width: 16, color: p.ink3, fontSize: 13 },
    step: { ...type.small, color: p.ink },
  });
