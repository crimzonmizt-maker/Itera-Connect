import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PickedFile } from '../data/repository';
import { friendlyError } from '../model/errors';
import { money, shortDate } from '../model/format';
import type { Attachment, NewEvent } from '../model/types';
import { checkFile, isImage, PendingFiles, pickFiles } from '../ui/Files';
import { useFocusRouter } from '../ui/FocusContext';
import { ItemsTable } from '../ui/ItemsTable';
import {
  Badge,
  Button,
  Card,
  Field,
  Muted,
  RefLink,
  Row,
  SectionTitle,
  TabPane,
  Tabs,
} from '../ui/primitives';
import { ProgressBar } from '../ui/ProgressBar';
import { space, type, type Palette } from '../ui/theme';
import { useStyles, useTheme } from '../ui/ThemeContext';
import { Timeline } from '../ui/Timeline';
import { ProjectHeader } from './ProjectHeader';
import type { ProjectState } from './useProject';

type Tab = 'overview' | 'selections';

/**
 * Everything here arrived pre-filtered by the repository: only entries this person is in the
 * audience of, and items with cost and supplier detail removed unless they are the buyer.
 * The screen just shows what it was given.
 *
 * There is deliberately no free-form message box. A homeowner talks by replying to an entry
 * (so the question stays attached to the thing it is about) or by deciding an approval.
 */
export function HomeownerHome({ state }: { state: ProjectState }) {
  const { tones } = useTheme();
  const styles = useStyles(makeStyles);
  const {
    project,
    events,
    items,
    rooms,
    members,
    viewer,
    progress,
    openApprovals,
    approvals,
    reply,
    decide,
    post,
    upload,
    now,
  } = state;
  const [changing, setChanging] = useState<string>(); // approvalId with the note box open
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  useFocusRouter((key) => setTab(key.startsWith('item:') ? 'selections' : 'overview'));
  if (!project || !viewer) return null;

  const toBuy = items.filter(
    (i) => i.purchasedBy === 'homeowner' && (i.status === 'proposed' || i.status === 'approved'),
  );

  return (
    <View style={{ gap: space.sm }}>
      <ProjectHeader project={project} members={members} viewer={viewer} now={now} />

      <SectionTitle>Where things stand</SectionTitle>
      <Card>
        <ProgressBar progress={progress} />
      </Card>

      <View style={{ marginTop: space.md }}>
        <Tabs<Tab>
          tabs={[
            {
              value: 'overview',
              label: 'What is happening',
              count: openApprovals.length || undefined,
            },
            { value: 'selections', label: 'Your selections', count: items.length },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {/* Both panes stay mounted (see TabPane), so switching tabs keeps a half-written note. */}
      <TabPane active={tab === 'selections'}>
        <SectionTitle hint="What is in the job, who buys it, and where each item is">
          Your selections
        </SectionTitle>
        <ItemsTable
          items={items}
          rooms={rooms}
          events={events}
          approvals={approvals}
          project={project}
          viewerRole="homeowner"
          now={now}
        />
      </TabPane>

      <TabPane active={tab === 'overview'}>
        {openApprovals.length > 0 ? (
          <>
            <SectionTitle hint="Work waits on these">Needs your decision</SectionTitle>
            {openApprovals.map((a) => {
              const overdue = a.dueBy !== undefined && new Date(a.dueBy) < new Date(now);
              const waitingOnContractor = a.decision === 'changes_requested';
              const tone = waitingOnContractor
                ? tones.severity.info
                : overdue
                  ? tones.severity.urgent
                  : tones.severity.attention;
              const item = a.itemId ? items.find((i) => i.id === a.itemId) : undefined;
              return (
                <Card key={a.approvalId} tone={tone}>
                  <Text style={styles.approvalTitle}>{a.title}</Text>
                  <Muted>
                    {a.amount !== undefined ? `${money(a.amount)} · ` : ''}
                    asked {shortDate(a.requestedAt)}
                    {a.round > 1 ? ` (revised)` : ''}
                    {a.dueBy && !waitingOnContractor
                      ? ` · ${overdue ? 'was due' : 'decide by'} ${shortDate(a.dueBy)}`
                      : ''}
                    {' · '}
                    <RefLink to={{ kind: 'event', id: a.requestedEventId }}>
                      open the request
                    </RefLink>
                    {item ? (
                      <>
                        {' · '}
                        <RefLink to={{ kind: 'item', id: item.id }}>see the item</RefLink>
                      </>
                    ) : null}
                  </Muted>
                  {waitingOnContractor ? (
                    <Badge
                      tone={tones.itemStatus.changes_requested}
                      text={`You asked for changes ${shortDate(a.decidedAt ?? now)} — waiting on the contractor`}
                    />
                  ) : changing === a.approvalId ? (
                    <View style={{ gap: space.sm }}>
                      <Field
                        label="What would you like changed?"
                        value={note}
                        onChangeText={setNote}
                        multiline
                        autoFocus
                        placeholder="e.g. Can we see a sample of Warm Gray against the tile first?"
                      />
                      <Row wrap>
                        <Button
                          title="Send change request"
                          glyph="↺"
                          disabled={!note.trim()}
                          onPress={() => {
                            void decide(a.approvalId, 'changes_requested', note.trim());
                            setChanging(undefined);
                            setNote('');
                          }}
                        />
                        <Button
                          title="Cancel"
                          kind="quiet"
                          onPress={() => setChanging(undefined)}
                        />
                      </Row>
                    </View>
                  ) : (
                    <Row wrap>
                      <Button
                        title="Approve"
                        glyph="✓"
                        onPress={() => decide(a.approvalId, 'approved')}
                      />
                      <Button
                        title="Request changes"
                        glyph="↺"
                        kind="secondary"
                        onPress={() => {
                          setChanging(a.approvalId);
                          setNote('');
                        }}
                      />
                    </Row>
                  )}
                  {waitingOnContractor && a.decisionNote ? (
                    <Text style={styles.note}>“{a.decisionNote}”</Text>
                  ) : null}
                </Card>
              );
            })}
          </>
        ) : null}

        {toBuy.length > 0 ? (
          <>
            <SectionTitle hint="Supplier and part numbers are on each item, under Your selections">
              Yours to order
            </SectionTitle>
            <Card style={{ gap: 6 }}>
              {toBuy.map((i) => (
                <Row key={i.id} wrap style={{ justifyContent: 'space-between' }}>
                  <Text style={styles.buyName}>
                    {i.name} · {i.quantity} {i.unit ?? ''}
                  </Text>
                  <Row>
                    <Badge tone={tones.purchaser.homeowner} text="You buy this" />
                    <RefLink to={{ kind: 'item', id: i.id }}>details</RefLink>
                  </Row>
                </Row>
              ))}
            </Card>
          </>
        ) : null}

        <SectionTitle hint="Your contractor and everyone else on the project will see it">
          Send a photo or file
        </SectionTitle>
        <SendFile projectId={project.id} onUpload={upload} onPost={post} />

        <SectionTitle hint="Newest first. Ask about anything here — your question stays with it.">
          What has happened
        </SectionTitle>
        <Timeline
          events={events}
          items={items}
          members={members}
          viewerRole="homeowner"
          onReply={reply}
          onDecide={decide}
          approvals={approvals}
        />
      </TabPane>
    </View>
  );
}

/**
 * A homeowner can put a photo or a PDF on the record — the leak under the sink, the receipt for
 * the tile they bought. It always has a caption, so it is about something; questions about an
 * existing entry still go in that entry's replies. The database addresses it to the team and
 * every homeowner on the project; the homeowner cannot narrow that.
 */
function SendFile({
  projectId,
  onUpload,
  onPost,
}: {
  projectId: string;
  onUpload: (files: PickedFile[]) => Promise<Attachment[]>;
  onPost: (e: NewEvent) => Promise<void>;
}) {
  const styles = useStyles(makeStyles);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const choose = async () => {
    const picked = await pickFiles('any');
    const refused = picked.map(checkFile).filter(Boolean);
    setProblem(refused.length ? refused.join(' ') : undefined);
    setFiles((f) => [...f, ...picked.filter((x) => !checkFile(x))]);
  };
  const send = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      const stored = await onUpload(files);
      const photo = stored.length === 1 && isImage(stored[0]!.mimeType) ? stored[0] : undefined;
      // One photo reads best as a photo entry; anything else is a note carrying its files.
      await onPost(
        photo
          ? { projectId, kind: 'photo', uri: photo.path, caption: caption.trim(), audience: [] }
          : { projectId, kind: 'note', body: caption.trim(), attachments: stored, audience: [] },
      );
      setFiles([]);
      setCaption('');
    } catch (e) {
      setProblem(friendlyError(e, 'That did not upload. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: space.sm }}>
      <Row wrap>
        <Button
          title="Choose photo or PDF"
          glyph="⎘"
          kind="secondary"
          disabled={busy}
          onPress={() => void choose()}
        />
      </Row>
      <PendingFiles files={files} onRemove={(i) => setFiles((f) => f.filter((_, j) => j !== i))} />
      <Field
        label="What is it?"
        value={caption}
        onChangeText={setCaption}
        multiline
        placeholder="e.g. Water under the vanity this morning / Receipt for the floor tile"
      />
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      <Row style={{ justifyContent: 'flex-end' }}>
        <Button
          title={busy ? 'Sending…' : 'Send'}
          glyph="↑"
          disabled={busy || files.length === 0 || !caption.trim()}
          onPress={() => void send()}
        />
      </Row>
    </Card>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    approvalTitle: { ...type.body, fontWeight: '600', color: p.ink },
    note: { ...type.small, color: p.ink2, fontStyle: 'italic' },
    buyName: { ...type.body, color: p.ink, flexShrink: 1 },
    problem: { ...type.small, color: p.amber, fontWeight: '600' },
  });
