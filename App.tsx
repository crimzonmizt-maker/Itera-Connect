import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LocalRepository } from './src/data/localRepository';
import type { NewProject as NewProjectInput, ProjectRepository } from './src/data/repository';
import { CONTRACTOR, HOMEOWNER, HOMEOWNER_2, NOW, sampleProject } from './src/data/sample';
import { supabase, supabaseConfigured } from './src/data/supabaseClient';
import { SupabaseRepository } from './src/data/supabaseRepository';
import { friendlyError } from './src/model/errors';
import { validInviteCode } from './src/model/format';
import { newProjectGate } from './src/model/plans';
import type { Id, Project, Role, Viewer } from './src/model/types';
import { ContractorHome } from './src/screens/ContractorHome';
import { HomeownerHome } from './src/screens/HomeownerHome';
import { NewProject } from './src/screens/NewProject';
import { SetNewPassword, SignIn } from './src/screens/SignIn';
import { useProject } from './src/screens/useProject';
import { FileUrlProvider } from './src/ui/Files';
import { Badge, Button, Card, Field, Muted, Row } from './src/ui/primitives';
import { space, type, type Palette } from './src/ui/theme';
import { FocusProvider, useFocus } from './src/ui/FocusContext';
import { ThemeProvider, useStyles, useTheme, type ThemePreference } from './src/ui/ThemeContext';

export default function App() {
  return (
    <ThemeProvider>
      {/* FocusProvider sits at the root: every Card anywhere may be a jump target. */}
      <FocusProvider>
        <Shell />
      </FocusProvider>
    </ThemeProvider>
  );
}

/** Everything inside here can read the theme. */
function Shell() {
  const { scheme } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        {supabaseConfigured ? <CloudApp /> : <LocalApp />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/** Light / dark / follow the device. Lives in the top bar on every screen. */
function ThemeSwitch() {
  const { preference, setPreference, scheme } = useTheme();
  const next: Record<ThemePreference, ThemePreference> = {
    system: 'dark',
    dark: 'light',
    light: 'system',
  };
  const label =
    preference === 'system' ? `Auto (${scheme})` : preference === 'dark' ? 'Dark' : 'Light';
  return (
    <Button
      title={label}
      glyph={scheme === 'dark' ? '☾' : '☀'}
      kind="quiet"
      onPress={() => setPreference(next[preference])}
    />
  );
}

/** No Supabase configured: the fictional sample project, with a switch to see any side. */
const viewers: { id: Id; role: Role; label: string }[] = [
  { id: CONTRACTOR.userId, role: 'contractor', label: 'Mike (contractor)' },
  { id: HOMEOWNER.userId, role: 'homeowner', label: 'Dana (homeowner)' },
  { id: HOMEOWNER_2.userId, role: 'homeowner', label: 'Sam (homeowner)' },
];

function LocalApp() {
  const { tones } = useTheme();
  const styles = useStyles(makeStyles);
  const [who, setWho] = useState<Id>(CONTRACTOR.userId);
  const repo = useMemo(() => new LocalRepository(CONTRACTOR.userId, { clock: () => NOW }), []);
  // Switch the repository first, then re-render: child effects run before parent effects, so an
  // effect here would leave the Workspace reading the previous viewer.
  const switchTo = (id: Id) => {
    repo.setViewer(id);
    setWho(id);
  };
  return (
    <>
      <View style={styles.devBar}>
        <Row wrap style={styles.barGroup}>
          <Muted>Sample project · no account · nothing is saved yet</Muted>
          <ThemeSwitch />
        </Row>
        <Row wrap style={styles.barGroup}>
          <Muted>Viewing as</Muted>
          {viewers.map((v) => (
            <Pressable
              key={v.id}
              accessibilityRole="button"
              accessibilityState={{ selected: who === v.id }}
              onPress={() => switchTo(v.id)}
              style={[styles.roleChip, who === v.id && styles.roleChipOn]}
            >
              <Badge tone={tones.role[v.role]} text={v.label} />
            </Pressable>
          ))}
        </Row>
      </View>
      <Workspace
        repo={repo}
        viewerKey={who}
        initialProjectId={sampleProject.id}
        clock={() => NOW}
      />
    </>
  );
}

/** Who is signed in, and what they typed at sign-up that the app still needs. */
type Session = { userId: Id; businessName?: string; pendingInvite?: string; displayName?: string };

function toSession(
  user: { id: string; user_metadata?: Record<string, unknown> } | undefined,
): Session | null {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    userId: user.id,
    businessName: text(meta.business_name),
    pendingInvite: text(meta.pending_invite),
    displayName: text(meta.display_name),
  };
}

/** Supabase configured: real sign-in, real rows, role decided by membership. */
function CloudApp() {
  const styles = useStyles(makeStyles);
  const [session, setSession] = useState<Session | null>();
  const [recovering, setRecovering] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [ready, setReady] = useState(false);
  // A code typed on the invitation door of this device, redeemed as soon as the session exists.
  const [typedInvite, setTypedInvite] = useState<{ code: string; name: string }>();
  useEffect(() => {
    void supabase()
      .auth.getSession()
      .then(({ data }) => setSession(toSession(data.session?.user)));
    const { data: sub } = supabase().auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(toSession(s?.user));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.userId;
  // A new repository per person: nothing the last person loaded survives a sign-out.
  const repo = useMemo(() => (userId ? new SupabaseRepository() : undefined), [userId]);

  // Redeem an invitation BEFORE the workspace loads, so the project is on the list it reads:
  // one typed on this device just now, or one stored on the account by a sign-up that had to
  // confirm its e-mail first (possibly on another device).
  const pendingInvite = typedInvite?.code ?? session?.pendingInvite;
  const displayName = typedInvite?.name ?? session?.displayName;
  const hadStoredInvite = !!session?.pendingInvite;
  useEffect(() => setNotice(undefined), [repo]);
  useEffect(() => {
    if (!repo) {
      setReady(false);
      return;
    }
    if (!pendingInvite || !validInviteCode(pendingInvite)) {
      setReady(true);
      return;
    }
    setReady(false);
    void repo
      .acceptInvitation(pendingInvite, displayName ?? '')
      .catch((e: unknown) => setNotice(friendlyError(e)))
      .finally(() => {
        setTypedInvite(undefined);
        if (hadStoredInvite) void supabase().auth.updateUser({ data: { pending_invite: null } });
        setReady(true);
      });
  }, [repo, pendingInvite, displayName, hadStoredInvite]);

  if (session === undefined) return <Muted>Loading…</Muted>;
  if (session && recovering)
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <SetNewPassword onDone={() => setRecovering(false)} />
      </ScrollView>
    );
  if (!session || !repo)
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <SignIn onInviteTyped={setTypedInvite} />
      </ScrollView>
    );
  if (!ready) return <Muted>Opening your project…</Muted>;
  return (
    <Workspace
      key={session.userId}
      repo={repo}
      viewerKey={session.userId}
      businessName={session.businessName}
      notice={notice}
      signOut={() => void supabase().auth.signOut()}
    />
  );
}

/**
 * The signed-in (or sample) area: which projects this person can open, which one is showing,
 * and the way to start a new one. Works the same over either repository.
 */
function Workspace({
  repo,
  viewerKey,
  initialProjectId,
  clock,
  signOut,
  businessName,
  notice,
}: {
  repo: ProjectRepository;
  viewerKey: string; // changes when the viewer changes, so the list reloads
  initialProjectId?: Id;
  clock?: () => string;
  signOut?: () => void;
  /** Typed at sign-up; fills in the business name on the first project form. */
  businessName?: string;
  /** Something to tell the person as they arrive (an invitation that could not be redeemed). */
  notice?: string;
}) {
  const { palette: p, tones } = useTheme();
  const styles = useStyles(makeStyles);
  const [viewer, setViewer] = useState<Viewer>();
  const [projects, setProjects] = useState<Project[]>();
  const [projectId, setProjectId] = useState<Id | undefined>(initialProjectId);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const [v, list] = await Promise.all([repo.viewer(), repo.listProjects()]);
      setViewer(v);
      setProjects(list);
      setLoadError(undefined);
      setProjectId((current) =>
        current && list.some((p) => p.id === current) ? current : list[0]?.id,
      );
    } catch (e) {
      setLoadError(friendlyError(e, 'Could not load your projects. Check your connection.'));
    }
  }, [repo]);
  useEffect(() => {
    void reload();
  }, [reload, viewerKey]);

  const create = async (input: NewProjectInput, businessName?: string) => {
    const project = await repo.createProject(input, businessName);
    await reload();
    setProjectId(project.id);
    setCreating(false);
  };

  const joined = async (id: Id) => {
    await reload();
    setProjectId(id);
    setJoining(false);
  };

  if (loadError && (!viewer || !projects))
    return (
      <View style={styles.content}>
        <Text style={[type.h2, { color: p.ink }]}>Could not open your projects</Text>
        <Muted>{loadError}</Muted>
        <Row>
          <Button title="Try again" onPress={() => void reload()} />
          {signOut ? <Button title="Sign out" kind="quiet" onPress={signOut} /> : null}
        </Row>
      </View>
    );
  if (!viewer || !projects) return <Muted>Loading…</Muted>;
  const isContractor = viewer.role === 'contractor';
  const owned = projects.filter((proj) => proj.businessId === viewer.businessId).length;
  const gate = newProjectGate(viewer.account, owned);
  const showForm = creating || (isContractor && projects.length === 0 && gate.allowed);
  const barHasContent = !!signOut || projects.length > 1 || (isContractor && !showForm);

  return (
    <>
      <View style={[styles.devBar, !barHasContent && { display: 'none' }]}>
        <Row wrap style={styles.barGroup}>
          {signOut ? <Muted>Signed in as {viewer.displayName}</Muted> : null}
          {signOut && viewer.account ? (
            <Badge
              tone={tones.role.contractor}
              text={viewer.account.plan === 'pro' ? '★ Pro' : 'Free plan'}
            />
          ) : null}
          {projects.length > 1
            ? projects.map((proj) => (
                <Pressable
                  key={proj.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: proj.id === projectId }}
                  onPress={() => {
                    setProjectId(proj.id);
                    setCreating(false);
                  }}
                  style={[styles.projectChip, proj.id === projectId && styles.projectChipOn]}
                >
                  <Text
                    style={[styles.projectChipText, proj.id === projectId && { color: p.onAccent }]}
                  >
                    {proj.name}
                  </Text>
                </Pressable>
              ))
            : null}
        </Row>
        <Row wrap style={styles.barGroup}>
          {isContractor && !showForm ? (
            <Button
              title="New project"
              glyph="＋"
              kind="secondary"
              disabled={!gate.allowed}
              onPress={() => {
                setJoining(false);
                setCreating(true);
              }}
            />
          ) : null}
          {signOut && projects.length > 0 && !joining ? (
            <Button
              title="Join with a code"
              kind="quiet"
              onPress={() => {
                setCreating(false);
                setJoining(true);
              }}
            />
          ) : null}
          {signOut ? <ThemeSwitch /> : null}
          {signOut ? <Button title="Sign out" kind="quiet" onPress={signOut} /> : null}
        </Row>
      </View>
      {notice || gate.note ? (
        <View style={styles.noticeBar}>
          {notice ? <Text style={styles.errorText}>▲ {notice}</Text> : null}
          {gate.note ? <Muted>{gate.note}</Muted> : null}
        </View>
      ) : null}

      {showForm ? (
        <ScrollView contentContainerStyle={styles.content}>
          <NewProject
            needsBusiness={!viewer.businessId}
            initialBusinessName={businessName}
            onCreate={create}
            onCancel={projects.length > 0 || !isContractor ? () => setCreating(false) : undefined}
          />
        </ScrollView>
      ) : joining ? (
        <ScrollView contentContainerStyle={styles.content}>
          <JoinProject
            repo={repo}
            defaultName={viewer.displayName}
            onJoined={joined}
            onCancel={() => setJoining(false)}
          />
        </ScrollView>
      ) : projectId ? (
        <ProjectScreen
          key={`${viewerKey}:${projectId}`}
          repo={repo}
          projectId={projectId}
          clock={clock}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[type.h2, { color: p.ink }]}>
            Welcome{signOut ? `, ${viewer.displayName}` : ''}
          </Text>
          <Muted>You are not on any project yet. Which one are you?</Muted>
          <Card style={{ gap: space.sm }}>
            <Text style={[type.body, { color: p.ink, fontWeight: '600' }]}>I run projects</Text>
            <Muted>Set up your business and your first project, then invite the homeowner.</Muted>
            <Row>
              <Button
                title="Set up my business"
                glyph="＋"
                disabled={!gate.allowed}
                onPress={() => setCreating(true)}
              />
            </Row>
          </Card>
          {signOut ? (
            <JoinProject repo={repo} defaultName={viewer.displayName} onJoined={joined} />
          ) : null}
        </ScrollView>
      )}
    </>
  );
}

/** A signed-in person redeems an invitation code; the project joins their list. */
function JoinProject({
  repo,
  defaultName,
  onJoined,
  onCancel,
}: {
  repo: ProjectRepository;
  defaultName: string;
  onJoined: (projectId: Id) => Promise<void>;
  onCancel?: () => void;
}) {
  const { palette: p } = useTheme();
  const styles = useStyles(makeStyles);
  const [code, setCode] = useState('');
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Card style={{ gap: space.sm }}>
      <Text style={[type.body, { color: p.ink, fontWeight: '600' }]}>
        I was invited to a project
      </Text>
      <Muted>Enter the code your contractor sent to this e-mail address.</Muted>
      <Field
        label="Invitation code"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\s/g, '').toUpperCase())}
        autoCapitalize="characters"
        placeholder="8 characters, e.g. ABCD 2345"
      />
      <Field label="Your name, as your contractor knows you" value={name} onChangeText={setName} />
      {error ? <Text style={styles.errorText}>▲ {error}</Text> : null}
      <Row>
        <Button
          title="Open the project"
          disabled={busy || !validInviteCode(code) || !name.trim()}
          onPress={async () => {
            setBusy(true);
            setError(undefined);
            try {
              await onJoined(await repo.acceptInvitation(code, name.trim()));
            } catch (e) {
              setError(friendlyError(e));
            } finally {
              setBusy(false);
            }
          }}
        />
        {onCancel ? <Button title="Cancel" kind="quiet" onPress={onCancel} /> : null}
      </Row>
    </Card>
  );
}

function ProjectScreen({
  repo,
  projectId,
  clock,
}: {
  repo: ProjectRepository;
  projectId: Id;
  clock?: () => string;
}) {
  const styles = useStyles(makeStyles);
  const state = useProject(repo, projectId, clock);
  // One stable function per repository, so photos are not re-requested on every render.
  const fileUrl = useCallback((path: string) => repo.fileUrl(path), [repo]);
  if (state.loading) return <Muted>Loading…</Muted>;
  return (
    <FileUrlProvider value={fileUrl}>
      <FocusScroll contentContainerStyle={styles.content}>
        {state.error ? (
          <Pressable onPress={state.clearError} style={styles.errorBar} accessibilityRole="alert">
            <Text style={styles.errorText}>▲ {state.error} — tap to dismiss</Text>
          </Pressable>
        ) : null}
        {state.viewer?.role === 'homeowner' ? (
          <HomeownerHome state={state} />
        ) : (
          <ContractorHome state={state} />
        )}
        <View style={{ height: space.xxl }} />
      </FocusScroll>
    </FileUrlProvider>
  );
}

/** A ScrollView the FocusProvider can drive, so "jump to" works on native as well as web. */
function FocusScroll(props: React.ComponentProps<typeof ScrollView>) {
  const { attachScroller } = useFocus();
  return <ScrollView ref={attachScroller} {...props} />;
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: p.bg },
    devBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      backgroundColor: p.panelAlt,
      borderBottomWidth: 1,
      borderBottomColor: p.line,
    },
    // A bar group may shrink below its content width so its chips wrap on a phone.
    barGroup: { flexShrink: 1, minWidth: 0 },
    roleChip: { padding: 2, borderRadius: 999, borderWidth: 2, borderColor: 'transparent' },
    roleChipOn: { borderColor: p.accent },
    projectChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: p.panel,
      borderWidth: 1,
      borderColor: p.line,
    },
    projectChipOn: { backgroundColor: p.accent, borderColor: p.accent },
    projectChipText: { ...type.small, fontWeight: '600', color: p.ink2 },
    content: {
      padding: space.lg,
      gap: space.md,
      maxWidth: 820,
      width: '100%',
      alignSelf: 'center',
      ...(Platform.OS === 'web' ? { minHeight: '100%' as unknown as number } : {}),
    },
    errorBar: {
      backgroundColor: p.amberSoft,
      borderColor: p.amber,
      borderWidth: 1,
      borderRadius: 10,
      padding: space.md,
    },
    errorText: { ...type.small, color: p.amber, fontWeight: '600' },
    noticeBar: {
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      gap: 4,
      backgroundColor: p.panelAlt,
      borderBottomWidth: 1,
      borderBottomColor: p.line,
    },
  });
