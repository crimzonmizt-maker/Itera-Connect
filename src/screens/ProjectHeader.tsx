import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { daysBetween, shortDate, validInviteCode } from '../model/format';
import type { EngagementMode, Invitation, Project, ProjectMember, Viewer } from '../model/types';
import { Badge, Button, Card, Field, Muted, Row } from '../ui/primitives';
import { radius, space, type, type Palette } from '../ui/theme';
import { useStyles, useTheme } from '../ui/ThemeContext';

const modeLabel: Record<EngagementMode, string> = {
  all_in: 'All-in — you supply materials',
  labor_only: 'Labor only — homeowner buys materials',
  hybrid: 'Hybrid — split per item',
};

/**
 * The top of every project screen, for both roles.
 *   line 1  project name
 *   line 2  address · started · target finish
 *   line 3  who runs it (the contractor), on its own line
 *   line 4  "Shared with Dana, Sam ▾" — expands to the member list; for the contractor it also
 *           holds "Add user to project", which used to be buried at the bottom of the page.
 */
export function ProjectHeader({
  project,
  members,
  viewer,
  now,
  onInvite,
}: {
  project: Project;
  members: ProjectMember[];
  viewer: Viewer;
  now: string;
  /** Contractor only. */
  onInvite?: (email: string) => Promise<Invitation>;
}) {
  const { tones } = useTheme();
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const contractor = members.find((m) => m.role === 'contractor');
  const homeowners = members.filter((m) => m.role === 'homeowner');
  const isContractor = viewer.role === 'contractor';
  const ownerName =
    contractor?.displayName ?? (isContractor ? viewer.displayName : 'Your contractor');
  const sharedWith =
    homeowners.length === 0
      ? 'Not shared with anyone yet'
      : isContractor
        ? `Shared with ${homeowners.map((h) => h.displayName.split(' ')[0]).join(', ')}`
        : `Shared with you${
            homeowners.length > 1
              ? ` and ${homeowners
                  .filter((h) => h.userId !== viewer.userId)
                  .map((h) => h.displayName.split(' ')[0])
                  .join(', ')}`
              : ''
          }`;

  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.h1}>{project.name}</Text>
      <Muted>
        {project.address}
        {project.startDate
          ? ` · ${daysBetween(project.startDate, now) >= 0 ? 'started' : 'starts'} ${shortDate(project.startDate)}`
          : ''}
        {project.targetDate
          ? ` · ${isContractor ? 'target finish' : 'aiming to finish around'} ${shortDate(project.targetDate)}`
          : ''}
      </Muted>
      {isContractor ? (
        <Muted>
          {modeLabel[project.mode]} · client prices {project.showPrices ? 'shown' : 'hidden'} on
          items you supply
        </Muted>
      ) : null}

      <Row wrap style={{ marginTop: space.xs }}>
        <Badge tone={tones.role.contractor} text={`${ownerName} — runs this project`} />
      </Row>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen((v) => !v)}
        style={styles.sharedRow}
      >
        <Text style={styles.sharedText}>
          {open ? '▾' : '▸'} {sharedWith}
        </Text>
      </Pressable>
      {open ? (
        <Card style={{ gap: space.sm }}>
          {homeowners.length === 0 ? <Muted>No homeowner has joined yet.</Muted> : null}
          {homeowners.map((h) => (
            <Row key={h.userId} wrap style={{ justifyContent: 'space-between' }}>
              <Row>
                <Badge tone={tones.role.homeowner} text={h.displayName} />
                {h.userId === viewer.userId ? <Muted>(you)</Muted> : null}
              </Row>
              {h.email && isContractor ? <Muted>{h.email}</Muted> : null}
            </Row>
          ))}
          <Muted>
            {isContractor
              ? 'Each person sees only the entries addressed to them. You choose per entry.'
              : 'You see the entries your contractor addressed to you.'}
          </Muted>
          {isContractor && onInvite ? <InvitePanel onInvite={onInvite} /> : null}
        </Card>
      ) : null}
    </View>
  );
}

/** "Add user to project": creates the invitation code the homeowner redeems at sign-in. */
function InvitePanel({ onInvite }: { onInvite: (email: string) => Promise<Invitation> }) {
  const styles = useStyles(makeStyles);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [invitation, setInvitation] = useState<Invitation>();
  const [error, setError] = useState<string>();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  if (!adding && !invitation)
    return (
      <Row>
        <Button
          title="Add user to project"
          glyph="＋"
          kind="secondary"
          onPress={() => setAdding(true)}
        />
      </Row>
    );
  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.label}>Add user to project</Text>
      <Muted>
        They get a code, sign in with this e-mail address, and see only what you have shared with
        them.
      </Muted>
      <Field
        label="Homeowner e-mail"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="name@example.com"
      />
      <Row wrap>
        <Button
          title="Create invitation"
          glyph="✉"
          disabled={!valid}
          onPress={() =>
            onInvite(email)
              .then((inv) => {
                setInvitation(inv);
                setError(undefined);
              })
              .catch((e: unknown) =>
                setError(e instanceof Error ? e.message : 'Could not create the invitation.'),
              )
          }
        />
        <Button
          title="Done"
          kind="quiet"
          onPress={() => {
            setAdding(false);
            setInvitation(undefined);
            setEmail('');
          }}
        />
      </Row>
      {invitation ? (
        <View style={styles.code}>
          <Text style={styles.codeLabel}>Invitation code for {invitation.email}</Text>
          <Text
            style={styles.codeText}
            selectable
            accessibilityLabel={`Invitation code ${invitation.code.split('').join(' ')}`}
          >
            {invitation.code.slice(0, 4)} {invitation.code.slice(4)}
          </Text>
          <Muted>
            Valid until {shortDate(invitation.expiresAt)}.{' '}
            {validInviteCode(invitation.code)
              ? 'No zeros or letter O, so it survives being read aloud.'
              : ''}
          </Muted>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    h1: { ...type.h1, color: p.ink },
    label: { ...type.label, color: p.ink3 },
    sharedRow: { paddingVertical: 6, minHeight: 36, justifyContent: 'center' },
    sharedText: { ...type.small, fontWeight: '600', color: p.accent },
    code: {
      backgroundColor: p.accentSoft,
      borderRadius: radius.md,
      padding: space.lg,
      gap: 4,
      alignItems: 'flex-start',
    },
    codeLabel: { ...type.label, color: p.ink3 },
    codeText: { ...type.h1, fontFamily: 'Menlo', letterSpacing: 2, color: p.accent },
    error: { ...type.small, color: p.amber, fontWeight: '600' },
  });
