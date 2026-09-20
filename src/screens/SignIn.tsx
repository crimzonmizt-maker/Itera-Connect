import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../data/supabaseClient';
import { SupabaseRepository } from '../data/supabaseRepository';
import { validInviteCode } from '../model/format';
import { Button, Card, Field, Muted, Row } from '../ui/primitives';
import { space, type, type Palette } from '../ui/theme';
import { useStyles } from '../ui/ThemeContext';

/**
 * One screen, two doors. Contractors sign in with an approved address.
 * Homeowners sign up with the invited address, then redeem the code the contractor gave them.
 * The database (Before User Created hook) refuses everyone else.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const styles = useStyles(makeStyles);
  const [mode, setMode] = useState<'signin' | 'invited'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      onSignedIn();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const signIn = () =>
    run(async () => {
      const { error: err } = await supabase().auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (err) throw err;
    });

  const acceptInvite = () =>
    run(async () => {
      const db = supabase();
      const address = email.trim().toLowerCase();
      // Try to sign in first (returning homeowner); otherwise create the account.
      const first = await db.auth.signInWithPassword({ email: address, password });
      if (first.error) {
        const { error: err } = await db.auth.signUp({
          email: address,
          password,
          options: { data: { display_name: name.trim() } },
        });
        if (err) throw err;
      }
      await SupabaseRepository.acceptInvitation(code, name.trim());
    });

  return (
    <View style={{ gap: space.md, maxWidth: 480, alignSelf: 'center', width: '100%' }}>
      <Text style={styles.h1}>Itera Connect</Text>
      <Row wrap>
        <Button
          title="I'm the contractor"
          kind={mode === 'signin' ? 'primary' : 'secondary'}
          onPress={() => setMode('signin')}
        />
        <Button
          title="I have an invitation code"
          kind={mode === 'invited' ? 'primary' : 'secondary'}
          onPress={() => setMode('invited')}
        />
      </Row>
      <Card>
        {mode === 'invited' ? (
          <Field
            label="Your name"
            value={name}
            onChangeText={setName}
            placeholder="As your contractor knows you"
          />
        ) : null}
        <Field
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder={mode === 'invited' ? 'Choose one — at least 12 characters' : ''}
        />
        {mode === 'invited' ? (
          <Field
            label="Invitation code"
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            autoCapitalize="characters"
            placeholder="8 characters"
          />
        ) : null}
        <Row>
          {mode === 'signin' ? (
            <Button title="Sign in" onPress={signIn} disabled={busy || !email || !password} />
          ) : (
            <Button
              title="Open my project"
              onPress={acceptInvite}
              disabled={
                busy || !email || password.length < 12 || !validInviteCode(code) || !name.trim()
              }
            />
          )}
        </Row>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Muted>
          {mode === 'signin'
            ? 'Contractor accounts are approved by Itera. Homeowners use the invitation door.'
            : 'Use the e-mail address your contractor sent the invitation to.'}
        </Muted>
      </Card>
    </View>
  );
}

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/IC_INVITE_INVALID/.test(m))
    return 'That code does not match an open invitation for this e-mail address. Check both with your contractor.';
  if (/invalid login|invalid credentials/i.test(m))
    return 'That e-mail and password did not match.';
  if (/approved contractors and invited homeowners/i.test(m))
    return 'This address has not been invited. Ask your contractor to send an invitation.';
  if (/network|fetch|timeout/i.test(m))
    return 'Could not connect. Check your connection and try again.';
  return 'That did not go through. Please try again.';
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    h1: { ...type.h1, color: p.ink, textAlign: 'center' },
    error: { ...type.small, color: p.amber, fontWeight: '600' },
  });
