import React, { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../data/supabaseClient';
import { friendlyError } from '../model/errors';
import { validInviteCode } from '../model/format';
import { appUrl } from '../ui/share';
import { Button, Card, Field, Muted, Row } from '../ui/primitives';
import { space, type, type Palette } from '../ui/theme';
import { useStyles } from '../ui/ThemeContext';

type Door = 'signin' | 'contractor' | 'invited' | 'reset';

const MIN_PASSWORD = 8;

/** An invitation link (…?invite=ABCD2345) opens the invitation door with the code filled in. */
function codeFromLink(): string {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  const code = new URLSearchParams(window.location.search).get('invite') ?? '';
  return validInviteCode(code) ? code.toUpperCase() : '';
}

/**
 * Three doors and a key under the mat:
 *   Sign in                 — anyone with an account
 *   Create contractor account — during the field test anyone may; the account starts on Pro
 *   I have an invitation    — homeowners: sign up with the invited address, then the code opens the project
 *   Forgot password         — sends a reset link
 * If the Supabase project asks people to confirm their e-mail, sign-up ends with "check your
 * e-mail"; an invitation code is kept on the account and redeemed at the first sign-in.
 */
export function SignIn({
  onInviteTyped,
}: {
  /** The app redeems this once the session exists, before it loads any project. */
  onInviteTyped: (invite: { code: string; name: string }) => void;
}) {
  const styles = useStyles(makeStyles);
  const linkCode = codeFromLink();
  const [door, setDoor] = useState<Door>(linkCode ? 'invited' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [business, setBusiness] = useState('');
  const [code, setCode] = useState(linkCode);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const address = email.trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);

  const run = async (fn: () => Promise<'signed-in' | 'check-email' | 'sent'>) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const outcome = await fn();
      // Signed in: the app notices on its own (the session changes) and moves on.
      if (outcome === 'check-email')
        setNotice(
          `Almost there — we sent a link to ${address}. Open it to confirm your address, then sign in here.` +
            (door === 'invited' ? ' Your project opens on that first sign-in.' : ''),
        );
      else setNotice(`If ${address} has an account, a reset link is on its way.`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const redirect = appUrl();

  const signIn = () =>
    run(async () => {
      const { error: err } = await supabase().auth.signInWithPassword({ email: address, password });
      if (err) throw err;
      return 'signed-in';
    });

  /** Sign up; true = signed in now, false = Supabase wants the address confirmed first. */
  const signUp = async (data: Record<string, string>) => {
    const { data: result, error: err } = await supabase().auth.signUp({
      email: address,
      password,
      options: { data, emailRedirectTo: redirect },
    });
    if (err) throw err;
    // Supabase answers an existing address with a user that has no identities, and no error.
    if (result.user && result.user.identities?.length === 0)
      throw new Error('User already registered');
    return !!result.session;
  };

  const createContractor = () =>
    run(async () => {
      const signedIn = await signUp({
        display_name: name.trim(),
        business_name: business.trim(),
      });
      return signedIn ? 'signed-in' : 'check-email';
    });

  const acceptInvite = () =>
    run(async () => {
      // Hand the code over first: signing in switches screens at once.
      onInviteTyped({ code, name: name.trim() });
      // A returning homeowner signs in; a new one gets an account first.
      const first = await supabase().auth.signInWithPassword({ email: address, password });
      if (first.error) {
        const signedIn = await signUp({ display_name: name.trim(), pending_invite: code });
        // Not signed in yet: the code rides on the account and is redeemed at first sign-in.
        if (!signedIn) return 'check-email';
      }
      return 'signed-in';
    });

  const sendReset = () =>
    run(async () => {
      const { error: err } = await supabase().auth.resetPasswordForEmail(address, {
        redirectTo: redirect,
      });
      if (err) throw err;
      return 'sent';
    });

  const doors: { value: Door; label: string }[] = [
    { value: 'signin', label: 'Sign in' },
    { value: 'contractor', label: 'New contractor account' },
    { value: 'invited', label: 'I have an invitation' },
  ];

  return (
    <View style={{ gap: space.md, maxWidth: 480, alignSelf: 'center', width: '100%' }}>
      <Text style={styles.h1}>Itera Connect</Text>
      <Row wrap style={{ justifyContent: 'center' }}>
        {doors.map((d) => (
          <Button
            key={d.value}
            title={d.label}
            kind={door === d.value ? 'primary' : 'secondary'}
            onPress={() => {
              setDoor(d.value);
              setError(undefined);
              setNotice(undefined);
            }}
          />
        ))}
      </Row>
      <Card>
        {door === 'contractor' || door === 'invited' ? (
          <Field
            label="Your name"
            value={name}
            onChangeText={setName}
            placeholder={door === 'invited' ? 'As your contractor knows you' : 'e.g. Mike Alvarez'}
          />
        ) : null}
        {door === 'contractor' ? (
          <Field
            label="Business name (optional)"
            value={business}
            onChangeText={setBusiness}
            placeholder="e.g. Alvarez Renovations"
          />
        ) : null}
        <Field
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        {door !== 'reset' ? (
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={door === 'signin' ? 'current-password' : 'new-password'}
            placeholder={
              door === 'signin' ? '' : `Choose one — at least ${MIN_PASSWORD} characters`
            }
          />
        ) : null}
        {door === 'invited' ? (
          <Field
            label="Invitation code"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\s/g, '').toUpperCase())}
            autoCapitalize="characters"
            placeholder="8 characters, e.g. ABCD 2345"
          />
        ) : null}
        <Row wrap>
          {door === 'signin' ? (
            <Button title="Sign in" onPress={signIn} disabled={busy || !emailOk || !password} />
          ) : door === 'contractor' ? (
            <Button
              title="Create my account"
              onPress={createContractor}
              disabled={busy || !emailOk || password.length < MIN_PASSWORD || !name.trim()}
            />
          ) : door === 'invited' ? (
            <Button
              title="Open my project"
              onPress={acceptInvite}
              disabled={
                busy ||
                !emailOk ||
                password.length < MIN_PASSWORD ||
                !validInviteCode(code) ||
                !name.trim()
              }
            />
          ) : (
            <Button title="Send reset link" onPress={sendReset} disabled={busy || !emailOk} />
          )}
          {door === 'signin' ? (
            <Button title="Forgot password?" kind="quiet" onPress={() => setDoor('reset')} />
          ) : null}
          {door === 'reset' ? (
            <Button title="Back to sign in" kind="quiet" onPress={() => setDoor('signin')} />
          ) : null}
        </Row>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <Muted>
          {door === 'signin'
            ? 'Contractors and homeowners sign in here.'
            : door === 'contractor'
              ? 'Field test: every new account starts on the Pro plan. You set up your business and first project next.'
              : door === 'invited'
                ? 'Use the e-mail address your contractor sent the invitation to. Already have an account? Enter your password and the code — the project is added.'
                : 'We will e-mail a link to choose a new password.'}
        </Muted>
      </Card>
    </View>
  );
}

/** After a reset link: the person is signed in for this one purpose and picks a new password. */
export function SetNewPassword({ onDone }: { onDone: () => void }) {
  const styles = useStyles(makeStyles);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: space.md, maxWidth: 480, alignSelf: 'center', width: '100%' }}>
      <Text style={styles.h1}>Choose a new password</Text>
      <Card>
        <Field
          label="New password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          placeholder={`At least ${MIN_PASSWORD} characters`}
        />
        <Row>
          <Button
            title="Save password"
            disabled={busy || password.length < MIN_PASSWORD}
            onPress={async () => {
              setBusy(true);
              setError(undefined);
              const { error: err } = await supabase().auth.updateUser({ password });
              setBusy(false);
              if (err) setError(friendlyError(err));
              else onDone();
            }}
          />
        </Row>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    h1: { ...type.h1, color: p.ink, textAlign: 'center' },
    error: { ...type.small, color: p.amber, fontWeight: '600' },
    notice: { ...type.small, color: p.accent, fontWeight: '600' },
  });
