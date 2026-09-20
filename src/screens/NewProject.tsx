import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NewProject as NewProjectInput } from '../data/repository';
import { addDays } from '../model/format';
import type { EngagementMode } from '../model/types';
import { Button, Card, Choice, Field, Muted, Row } from '../ui/primitives';
import { space, type, type Palette } from '../ui/theme';
import { useStyles } from '../ui/ThemeContext';

const MODES: { value: EngagementMode; label: string; glyph: string; explain: string }[] = [
  {
    value: 'all_in',
    label: 'All-in',
    glyph: '◆',
    explain:
      'You supply labor and materials for one price. The homeowner sees what is in the job but not the price of each item unless you choose to show it.',
  },
  {
    value: 'labor_only',
    label: 'Labor only',
    glyph: '⚒',
    explain:
      'You do the work; the homeowner buys the materials. They see supplier and part numbers on every item so they can order it.',
  },
  {
    value: 'hybrid',
    label: 'Hybrid',
    glyph: '◐',
    explain:
      'Decided item by item — you supply some, they buy some. Prices are shown. Most real jobs end up here.',
  },
];

/**
 * The contractor starts a project. Mode is the one decision that shapes everything after it,
 * so it gets a full sentence of explanation, not a tooltip. Everything else can be changed later.
 */
export function NewProject({
  needsBusiness,
  onCreate,
  onCancel,
}: {
  /** True for a contractor's very first project: we also need a name for their business. */
  needsBusiness: boolean;
  onCreate: (input: NewProjectInput, businessName?: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [businessName, setBusinessName] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [homeownerName, setHomeownerName] = useState('');
  const [mode, setMode] = useState<EngagementMode>('hybrid');
  const [weeks, setWeeks] = useState('6');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const weeksNum = Number(weeks);
  const weeksBad = weeks.trim() !== '' && (Number.isNaN(weeksNum) || weeksNum < 0);
  const valid =
    name.trim().length > 0 && (!needsBusiness || businessName.trim().length > 0) && !weeksBad;
  const chosen = MODES.find((m) => m.value === mode)!;

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onCreate(
        {
          name: name.trim(),
          address: address.trim(),
          homeownerName: homeownerName.trim() || undefined,
          mode,
          targetDate:
            weeks.trim() === '' ? undefined : addDays(new Date().toISOString(), weeksNum * 7),
        },
        needsBusiness ? businessName.trim() : undefined,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the project.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.md }}>
      <Text style={styles.title}>
        {needsBusiness ? 'Set up your business and first project' : 'New project'}
      </Text>
      {needsBusiness ? (
        <Field
          label="Your business name"
          value={businessName}
          onChangeText={setBusinessName}
          placeholder="Alvarez Remodeling"
          autoFocus
        />
      ) : null}
      <Field
        label="Project name"
        value={name}
        onChangeText={setName}
        placeholder="Whitfield primary bath"
        autoFocus={!needsBusiness}
      />
      <Field
        label="Address"
        value={address}
        onChangeText={setAddress}
        placeholder="418 Larkspur Ct"
      />
      <Field
        label="Homeowner name (you will invite them properly afterwards)"
        value={homeownerName}
        onChangeText={setHomeownerName}
        placeholder="Dana Whitfield"
      />
      <Choice
        label="How you are engaged"
        options={MODES.map((m) => ({ value: m.value, label: m.label, glyph: m.glyph }))}
        value={mode}
        onChange={setMode}
      />
      <View style={styles.explain}>
        <Text style={styles.explainText}>{chosen.explain}</Text>
        <Muted>You can change this later, and override it on any single item.</Muted>
      </View>
      <View style={{ width: 200 }}>
        <Field
          label="Target finish (weeks from now)"
          value={weeks}
          onChangeText={setWeeks}
          keyboardType="number-pad"
          placeholder="6"
        />
      </View>
      {weeksBad ? (
        <Text style={styles.error}>Enter a number of weeks, or leave it blank.</Text>
      ) : null}
      {error ? <Text style={styles.error}>▲ {error}</Text> : null}
      <Row wrap style={{ justifyContent: 'flex-end' }}>
        {onCancel ? <Button title="Cancel" kind="quiet" onPress={onCancel} /> : null}
        <Button title="Create project" glyph="✓" onPress={submit} disabled={busy || !valid} />
      </Row>
    </Card>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    title: { ...type.h2, color: p.ink },
    explain: { backgroundColor: p.accentSoft, borderRadius: 8, padding: space.md, gap: 4 },
    explainText: { ...type.body, color: p.ink },
    error: { ...type.small, color: p.amber, fontWeight: '600' },
  });
