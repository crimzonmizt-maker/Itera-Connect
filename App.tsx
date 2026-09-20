import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LocalRepository } from './src/data/localRepository';
import type { NewProject as NewProjectInput, ProjectRepository } from './src/data/repository';
import { CONTRACTOR, HOMEOWNER, HOMEOWNER_2, NOW, sampleProject } from './src/data/sample';
import { supabase, supabaseConfigured } from './src/data/supabaseClient';
import { SupabaseRepository } from './src/data/supabaseRepository';
import type { Id, Project, Role, Viewer } from './src/model/types';
import { ContractorHome } from './src/screens/ContractorHome';
import { HomeownerHome } from './src/screens/HomeownerHome';
import { NewProject } from './src/screens/NewProject';
import { SignIn } from './src/screens/SignIn';
import { useProject } from './src/screens/useProject';
import { Badge, Button, Muted, Row } from './src/ui/primitives';
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

/** Supabase configured: real sign-in, real rows, role decided by membership. */
function CloudApp() {
  const styles = useStyles(makeStyles);
  const [signedIn, setSignedIn] = useState<boolean>();
  const repo = useMemo(() => new SupabaseRepository(), []);
  useEffect(() => {
    void supabase()
      .auth.getSession()
      .then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = supabase().auth.onAuthStateChange((_e, session) =>
      setSignedIn(!!session),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  if (signedIn === undefined) return <Muted>Loading…</Muted>;
  if (!signedIn)
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <SignIn onSignedIn={() => setSignedIn(true)} />
      </ScrollView>
    );
  return <Workspace repo={repo} viewerKey="cloud" signOut={() => void supabase().auth.signOut()} />;
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
}: {
  repo: ProjectRepository;
  viewerKey: string; // changes when the viewer changes, so the list reloads
  initialProjectId?: Id;
  clock?: () => string;
  signOut?: () => void;
}) {
  const { palette: p } = useTheme();
  const styles = useStyles(makeStyles);
  const [viewer, setViewer] = useState<Viewer>();
  const [projects, setProjects] = useState<Project[]>();
  const [projectId, setProjectId] = useState<Id | undefined>(initialProjectId);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    const [v, list] = await Promise.all([repo.viewer(), repo.listProjects()]);
    setViewer(v);
    setProjects(list);
    setProjectId((current) =>
      current && list.some((p) => p.id === current) ? current : list[0]?.id,
    );
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

  if (!viewer || !projects) return <Muted>Loading…</Muted>;
  const isContractor = viewer.role === 'contractor';
  const showForm = creating || (isContractor && projects.length === 0);
  const barHasContent = !!signOut || projects.length > 1 || (isContractor && !showForm);

  return (
    <>
      <View style={[styles.devBar, !barHasContent && { display: 'none' }]}>
        <Row wrap style={styles.barGroup}>
          {signOut ? <Muted>Signed in as {viewer.displayName}</Muted> : null}
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
              onPress={() => setCreating(true)}
            />
          ) : null}
          {signOut ? <ThemeSwitch /> : null}
          {signOut ? <Button title="Sign out" kind="quiet" onPress={signOut} /> : null}
        </Row>
      </View>

      {showForm ? (
        <ScrollView contentContainerStyle={styles.content}>
          <NewProject
            needsBusiness={!viewer.businessId}
            onCreate={create}
            onCancel={projects.length > 0 ? () => setCreating(false) : undefined}
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
        <View style={styles.content}>
          <Text style={type.h2}>No project yet</Text>
          <Muted>
            When your contractor invites you, redeem the code on the sign-in screen and the project
            will appear here.
          </Muted>
        </View>
      )}
    </>
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
  if (state.loading) return <Muted>Loading…</Muted>;
  return (
    <>
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
    </>
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
  });
