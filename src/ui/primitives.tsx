import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import type { Ref } from '../model/types';
import { refKey, useFocus, useFocusTarget } from './FocusContext';
import { radius, space, type, type Tone, type Palette } from './theme';
import { useStyles, useTheme } from './ThemeContext';

export function Card({
  children,
  style,
  tone,
  focusKey,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: Tone;
  /** Registers the card as a jump target (see FocusContext); it glows briefly when jumped to. */
  focusKey?: string;
}) {
  const styles = useStyles(makeStyles);
  const { ref, isFocused } = useFocusTarget(focusKey ?? '');
  return (
    <View
      ref={focusKey ? ref : undefined}
      style={[
        styles.card,
        tone && { borderLeftColor: tone.fg, borderLeftWidth: 4 },
        isFocused && focusKey ? styles.cardFocused : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Inline link text. Presses jump to the referenced entry or item. */
export function RefLink({
  to,
  children,
}: {
  to: Pick<Ref, 'kind' | 'id'>;
  children: React.ReactNode;
}) {
  const { focus } = useFocus();
  const styles = useStyles(makeStyles);
  return (
    <Text accessibilityRole="link" onPress={() => focus(refKey(to))} style={styles.link}>
      {children}
    </Text>
  );
}

/** A row of reference chips: "Related: [Cape Breton vanity] [Vanity install · Oct 7]". */
export function RefRow({ refs, label = 'About' }: { refs: Ref[]; label?: string }) {
  const { focus } = useFocus();
  const styles = useStyles(makeStyles);
  if (refs.length === 0) return null;
  return (
    <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
      <Text style={styles.hint}>{label}:</Text>
      {refs.map((r) => (
        <Pressable
          key={refKey(r)}
          accessibilityRole="link"
          onPress={() => focus(refKey(r))}
          style={styles.refChip}
        >
          <Text style={styles.refChipText}>
            {r.kind === 'item' ? '▪ ' : '↗ '}
            {r.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Badge({ tone, text }: { tone: Tone; text?: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View
      style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.fg }]}
      accessibilityLabel={text ?? tone.label}
    >
      <Text style={[styles.badgeGlyph, { color: tone.fg }]}>{tone.glyph}</Text>
      <Text style={[styles.badgeText, { color: tone.fg }]}>{text ?? tone.label}</Text>
    </View>
  );
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.label}>{children}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  glyph,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
  glyph?: string;
}) {
  const { palette: p } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${kind}`],
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          kind === 'primary' ? { color: p.onAccent } : { color: p.accent },
        ]}
      >
        {glyph ? `${glyph}  ` : ''}
        {title}
      </Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { palette: p } = useTheme();
  const styles = useStyles(makeStyles);
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={p.ink3}
        {...rest}
        style={[styles.input, rest.multiline && { minHeight: 72, textAlignVertical: 'top' }, style]}
      />
    </View>
  );
}

/** A single-select row of chips. Always a label + text; the selected chip is filled, never colour-only. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: { value: T; label: string; glyph?: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
  hint?: string;
}) {
  const { palette: p } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              onPress={() => onChange(o.value)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && { color: p.onAccent }]}>
                {o.glyph ? `${o.glyph} ` : ''}
                {o.label}
                {on ? ' ✓' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Segmented tabs. Always label text; the selected tab is filled and underlined, never colour-only. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { palette: p } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <Pressable
            key={t.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            aria-selected={on}
            onPress={() => onChange(t.value)}
            style={[styles.tab, on && styles.tabOn]}
          >
            <Text style={[styles.tabText, on && { color: p.onAccent }]}>
              {t.label}
              {t.count !== undefined ? ` · ${t.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The body of one tab. Inactive panes stay mounted but hidden, so switching tabs never loses a
 * half-written note, an open item form or the concierge card you were on.
 */
export function TabPane({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <View
      style={[{ gap: space.sm }, !active && { display: 'none' }]}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </View>
  );
}

export function Row({
  children,
  style,
  wrap,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  wrap?: boolean;
}) {
  const styles = useStyles(makeStyles);
  return <View style={[styles.row, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  return <Text style={styles.muted}>{children}</Text>;
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: p.panel,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: p.line,
      padding: space.lg,
      gap: space.sm,
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 9,
      paddingVertical: 3,
      alignSelf: 'flex-start',
    },
    badgeGlyph: { fontSize: 11 },
    badgeText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
    sectionTitle: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: space.sm,
      marginTop: space.xl,
      marginBottom: space.sm,
      flexWrap: 'wrap',
    },
    label: { ...type.label, color: p.ink3 },
    hint: { ...type.small, color: p.ink3 },
    button: {
      paddingHorizontal: space.lg,
      paddingVertical: 10,
      borderRadius: radius.md,
      alignItems: 'center',
      minHeight: 44,
      justifyContent: 'center',
    },
    button_primary: { backgroundColor: p.accent },
    button_secondary: { backgroundColor: p.accentSoft },
    button_quiet: { backgroundColor: 'transparent' },
    buttonText: { fontSize: 15, fontWeight: '600' },
    input: {
      borderWidth: 1,
      borderColor: p.line,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: 10,
      fontSize: 15,
      color: p.ink,
      backgroundColor: p.panel,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    muted: { ...type.small, color: p.ink3 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: p.panelAlt,
      minHeight: 36,
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: p.accent },
    chipText: { ...type.small, fontWeight: '600', color: p.ink2 },
    cardFocused: { borderColor: p.accent, borderWidth: 2, backgroundColor: p.accentSoft },
    tabs: {
      flexDirection: 'row',
      backgroundColor: p.panelAlt,
      borderRadius: radius.md,
      padding: 3,
      gap: 3,
      alignSelf: 'flex-start',
      flexWrap: 'wrap',
    },
    tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm, minHeight: 36 },
    tabOn: { backgroundColor: p.accent },
    tabText: { ...type.small, fontWeight: '600', color: p.ink2 },
    link: { color: p.accent, textDecorationLine: 'underline', fontWeight: '600' },
    refChip: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: p.accent,
      backgroundColor: p.panel,
    },
    refChipText: { ...type.small, color: p.accent, fontWeight: '600' },
  });
