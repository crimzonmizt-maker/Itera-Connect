import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PickedFile } from '../data/repository';
import { friendlyError } from '../model/errors';
import { addDays, money, newId, parseWhen, shortDate } from '../model/format';
import { isOpen } from '../model/progress';
import type { Attachment, EventKind, Id, Item, NewEvent, ProjectMember } from '../model/types';
import { audienceLabel, defaultAudience, homeownerIds } from '../model/visibility';
import { ConciergePanel } from '../ui/ConciergePanel';
import { checkFile, isImage, PendingFiles, pickFiles } from '../ui/Files';
import { ItemsTable } from '../ui/ItemsTable';
import { useFocus, useFocusRouter } from '../ui/FocusContext';
import {
  Badge,
  Button,
  Card,
  Field,
  Muted,
  Row,
  SectionTitle,
  TabPane,
  Tabs,
} from '../ui/primitives';
import { ProgressBar } from '../ui/ProgressBar';
import { kindGlyph, radius, space, type, type Palette } from '../ui/theme';
import { useStyles, useTheme } from '../ui/ThemeContext';
import { Timeline } from '../ui/Timeline';
import { ItemForm } from './ItemForm';
import { ProjectHeader } from './ProjectHeader';
import type { ProjectState } from './useProject';

type Tab = 'overview' | 'selections';

export function ContractorHome({ state }: { state: ProjectState }) {
  const {
    project,
    events,
    items,
    rooms,
    members,
    viewer,
    progress,
    suggestions,
    approvals,
    post,
    reply,
    decide,
    invite,
    saveItem,
    saveRoom,
    setDates,
    upload,
    now,
  } = state;
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState<Item | 'new' | undefined>();
  const [asking, setAsking] = useState<Item>();
  const { focus } = useFocus();
  // Items and the item forms live on the Selections tab; everything else on Overview.
  useFocusRouter((key) =>
    setTab(key.startsWith('item:') || key.startsWith('form:') ? 'selections' : 'overview'),
  );
  // "Revise and ask again" from a concierge card or an entry: open the approval form for that
  // item on the Selections tab and scroll to it. The form reuses the approvalId, so this is
  // round 2 of the same question, not a new one.
  const askAgain = (itemId: Id) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    setEditing(undefined);
    setAsking(item);
    focus(`form:ask:${item.id}`);
  };
  if (!project || !viewer) return null;
  const openCount = approvals.filter(isOpen).length;

  return (
    <View style={{ gap: space.sm }}>
      <ProjectHeader
        project={project}
        members={members}
        viewer={viewer}
        now={now}
        onInvite={invite}
        onSetDates={setDates}
      />

      <View style={{ marginTop: space.md }}>
        <Tabs<Tab>
          tabs={[
            { value: 'overview', label: 'Overview', count: suggestions.active.length },
            { value: 'selections', label: 'Selections & materials', count: items.length },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {/* Both panes stay mounted (see TabPane), so a tab switch keeps form and pager state. */}
      <TabPane active={tab === 'overview'}>
        <SectionTitle hint="Plan the tasks, then Start, Update or Done — each goes on the record and the homeowner sees it">
          Tasks &amp; progress
        </SectionTitle>
        <Card>
          <ProgressBar
            progress={progress}
            onAdvance={(m, status, body) =>
              post({
                projectId: project.id,
                kind: 'milestone',
                title: m.title,
                status,
                due: m.due,
                body,
                audience: homeownerIds(members),
              })
            }
            now={now}
            onAdd={(title, due) =>
              post({
                projectId: project.id,
                kind: 'milestone',
                title,
                status: 'planned',
                due,
                audience: homeownerIds(members),
              })
            }
          />
        </Card>

        <SectionTitle
          hint={`${suggestions.active.length} to look at${
            openCount ? ` · ${openCount} approval${openCount === 1 ? '' : 's'} open` : ''
          }${suggestions.archived.length ? ` · ${suggestions.archived.length} set aside` : ''}`}
        >
          Concierge
        </SectionTitle>
        <ConciergePanel
          active={suggestions.active}
          archived={suggestions.archived}
          members={members}
          authorName={viewer.displayName.split(' ')[0] ?? viewer.displayName}
          projectId={project.id}
          now={now}
          onPost={post}
          onReply={reply}
          onRevise={askAgain}
          onWithdraw={(approvalId, note) => decide(approvalId, 'withdrawn', note)}
        />

        <SectionTitle hint="Anything you post here goes on the record. Pick who sees it; nobody else can.">
          Post an update
        </SectionTitle>
        {/* Keyed on membership so the audience default is rebuilt if a homeowner joins. */}
        <Compose
          key={members.map((m) => m.userId).join(',')}
          projectId={project.id}
          members={members}
          items={items}
          now={now}
          onPost={post}
          onUpload={upload}
        />

        <SectionTitle hint="Every note, delivery and decision, newest first">Timeline</SectionTitle>
        <Timeline
          events={events}
          items={items}
          members={members}
          viewerRole="contractor"
          onReply={reply}
          onDecide={decide}
          onReschedule={(job, newDate) =>
            post({
              projectId: project.id,
              kind: 'schedule',
              title: job.title,
              date: newDate,
              who: job.who,
              needs: job.needs,
              audience: job.audience,
              body: `Moved from ${shortDate(job.date)}.`,
            })
          }
          approvals={approvals}
          onRevise={askAgain}
          onWithdraw={(approvalId, note) => decide(approvalId, 'withdrawn', note)}
        />
      </TabPane>

      <TabPane active={tab === 'selections'}>
        <SectionTitle hint="Sourcing goes to whoever has to buy the item. Anything marked “Your business only” is never shown to the homeowner.">
          Selections &amp; materials
        </SectionTitle>
        {editing ? (
          <ItemForm
            key={editing === 'new' ? 'new' : editing.id}
            project={project}
            members={members}
            rooms={rooms}
            initial={editing === 'new' ? undefined : editing}
            onSave={async ({ item, newRoom, order, delivery }) => {
              // A room named in the form is created first, so the item can point at it.
              if (newRoom) item.roomId = (await saveRoom({ name: newRoom.name })).id;
              const saved = await saveItem(item);
              // A status change to ordered / delivered goes on the record as an entry, so the
              // expected date and the count are visible to everyone and checkable by the concierge.
              const shared = homeownerIds(members);
              if (order)
                await post({
                  projectId: project.id,
                  kind: 'order',
                  itemId: saved.id,
                  expectedDate: order.expectedDate,
                  audience: shared,
                  refs: [{ kind: 'item', id: saved.id, label: saved.name }],
                });
              if (delivery)
                await post({
                  projectId: project.id,
                  kind: 'delivery',
                  itemId: saved.id,
                  ...delivery,
                  // Short or damaged deliveries start as the business's problem to chase.
                  audience: delivery.received - delivery.damaged >= delivery.expected ? shared : [],
                  refs: [{ kind: 'item', id: saved.id, label: saved.name }],
                });
              setEditing(undefined);
            }}
            onCancel={() => setEditing(undefined)}
          />
        ) : asking ? (
          <AskApproval
            item={asking}
            members={members}
            // Re-asking after "change it" continues the same question; after a withdrawal it is
            // a new one, so only an open approval is carried forward.
            round={(approvals.find((a) => a.itemId === asking.id && isOpen(a))?.round ?? 0) + 1}
            existingApprovalId={
              approvals.find((a) => a.itemId === asking.id && isOpen(a))?.approvalId
            }
            onPost={async (e) => {
              await post(e);
              setAsking(undefined);
            }}
            onCancel={() => setAsking(undefined)}
          />
        ) : (
          <Row>
            <Button
              title="Add item"
              glyph="＋"
              kind="secondary"
              onPress={() => setEditing('new')}
            />
          </Row>
        )}
        <ItemsTable
          items={items}
          rooms={rooms}
          events={events}
          approvals={approvals}
          project={project}
          viewerRole="contractor"
          now={now}
          onEdit={(item) => {
            setAsking(undefined);
            setEditing(item);
          }}
          onRequestApproval={(item) => askAgain(item.id)}
        />
      </TabPane>
    </View>
  );
}

const kinds: EventKind[] = ['note', 'milestone', 'schedule', 'photo', 'document_sent'];

function Compose({
  projectId,
  members,
  items,
  now,
  onPost,
  onUpload,
}: {
  projectId: string;
  members: ProjectMember[];
  items: Item[];
  now: string;
  onPost: (e: NewEvent) => Promise<void>;
  onUpload: (files: PickedFile[]) => Promise<Attachment[]>;
}) {
  const { palette: p, tones } = useTheme();
  const styles = useStyles(makeStyles);
  const [kind, setKind] = useState<EventKind>('note');
  const [audience, setAudience] = useState<Id[]>(() => defaultAudience('note', members));
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('7');
  const [to, setTo] = useState('');
  const [layers, setLayers] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [about, setAbout] = useState<Id>(); // the item this entry is about, if any
  const [problem, setProblem] = useState<string>();
  const homeowners = members.filter((m) => m.role === 'homeowner');
  const date = parseWhen(when, now);

  const choose = async () => {
    const picked = await pickFiles(kind === 'photo' ? 'photo' : 'any');
    const refused = picked.map(checkFile).filter(Boolean);
    setProblem(refused.length ? refused.join(' ') : undefined);
    setFiles((f) => [...f, ...picked.filter((x) => !checkFile(x))]);
  };

  const pick = (k: EventKind) => {
    setKind(k);
    setAudience(defaultAudience(k, members));
    if (k === 'document_sent' && !to) setTo(homeowners[0]?.email ?? '');
  };
  const toggle = (id: Id) =>
    setAudience((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const valid =
    kind === 'photo'
      ? files.some((f) => isImage(f.mimeType))
      : kind === 'note'
        ? body.trim().length > 0 || files.length > 0
        : kind === 'document_sent'
          ? title.trim().length > 0 && to.trim().length > 0
          : kind === 'schedule'
            ? title.trim().length > 0 && date !== undefined
            : title.trim().length > 0;

  const submit = async () => {
    setBusy(true);
    setProblem(undefined);
    let stored: Attachment[];
    try {
      // Files go up first; the entry that points at them is what lets the homeowner open them.
      stored = await onUpload(files);
    } catch (e) {
      setProblem(friendlyError(e, 'The file did not upload. Try again.'));
      setBusy(false);
      return;
    }
    const item = items.find((i) => i.id === about);
    const photo = kind === 'photo' ? stored.find((a) => isImage(a.mimeType)) : undefined;
    const attachments = stored.filter((a) => a !== photo);
    const base = {
      projectId,
      audience,
      body: body.trim() || undefined,
      ...(attachments.length ? { attachments } : {}),
      ...(item ? { refs: [{ kind: 'item' as const, id: item.id, label: item.name }] } : {}),
    };
    let event: NewEvent;
    switch (kind) {
      case 'milestone':
        event = { ...base, kind, title: title.trim(), status: 'done' };
        break;
      case 'schedule':
        event = {
          ...base,
          kind,
          title: title.trim(),
          date: date ?? addDays(now, 7),
        };
        break;
      case 'photo':
        event = { ...base, kind, uri: photo!.path, caption: body.trim() || undefined };
        break;
      case 'document_sent':
        event = {
          ...base,
          kind,
          title: title.trim(),
          via: 'email',
          to: to.trim(),
          layers: layers
            .split(',')
            .map((l) => l.trim())
            .filter(Boolean),
        };
        break;
      default:
        event = { ...base, kind: 'note' };
    }
    try {
      await onPost(event);
      // Back to a blank Note addressed to the default audience — the previous post's kind,
      // date and recipients must not leak into the next one.
      setBody('');
      setTitle('');
      setLayers('');
      setTo('');
      setWhen('7');
      setFiles([]);
      setAbout(undefined);
      setKind('note');
      setAudience(defaultAudience('note', members));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Row wrap>
        {kinds.map((k) => (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === k }}
            aria-selected={kind === k}
            onPress={() => pick(k)}
            style={[styles.chip, kind === k && styles.chipOn]}
          >
            <Text style={[styles.chipText, kind === k && { color: p.onAccent }]}>
              {kindGlyph[k].glyph} {kindGlyph[k].label}
            </Text>
          </Pressable>
        ))}
      </Row>
      {kind === 'milestone' || kind === 'schedule' || kind === 'document_sent' ? (
        <Field
          label={
            kind === 'milestone'
              ? 'Milestone finished'
              : kind === 'schedule'
                ? 'What is scheduled'
                : 'Document title'
          }
          value={title}
          onChangeText={setTitle}
          placeholder={
            kind === 'milestone'
              ? 'e.g. Tile floor & walls'
              : kind === 'schedule'
                ? 'e.g. Plumber final connections'
                : 'e.g. Bath quote v2 — labor only'
          }
        />
      ) : null}
      {kind === 'schedule' ? (
        <>
          <Field
            label="When — a date like 10/14, or a number of days from today"
            value={when}
            onChangeText={setWhen}
            placeholder="e.g. 10/14 or 7"
          />
          <Muted>
            {date ? `On ${shortDate(date)}` : 'Could not read that date — try 10/14 or 7.'}
          </Muted>
        </>
      ) : null}
      {kind === 'document_sent' ? (
        <>
          <Field
            label="Sent by e-mail to"
            value={to}
            onChangeText={setTo}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="name@example.com"
          />
          <Field
            label="Layers included (comma-separated)"
            value={layers}
            onChangeText={setLayers}
            placeholder="e.g. layout, dimensions — leave blank if not a drawing"
          />
        </>
      ) : null}
      <Field
        label={kind === 'photo' ? 'Caption' : 'Details'}
        value={body}
        onChangeText={setBody}
        multiline
        placeholder={
          kind === 'note' ? 'What happened, or what you want the homeowner to know' : 'Optional'
        }
      />

      <View style={{ gap: space.xs }}>
        <Row wrap>
          <Button
            title={kind === 'photo' ? 'Choose photos' : 'Attach photo or PDF'}
            glyph="⎘"
            kind="secondary"
            disabled={busy}
            onPress={() => void choose()}
          />
          {kind === 'photo' ? <Muted>On a phone this offers the camera too.</Muted> : null}
        </Row>
        <PendingFiles
          files={files}
          onRemove={(i) => setFiles((f) => f.filter((_, j) => j !== i))}
        />
      </View>

      {items.length > 0 ? (
        <View style={{ gap: space.xs }}>
          <Text style={styles.label}>About an item (optional) — links the entry to it</Text>
          <Row wrap>
            {items.map((it) => {
              const on = about === it.id;
              return (
                <Pressable
                  key={it.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  aria-checked={on}
                  onPress={() => setAbout(on ? undefined : it.id)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {it.name}
                    {it.sourcing?.sku ? ` · ${it.sourcing.sku}` : ''}
                    {on ? ' ✓' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </View>
      ) : null}

      <View style={{ gap: space.xs }}>
        <Text style={styles.label}>Who sees this</Text>
        <Row wrap>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: audience.length === 0 }}
            aria-selected={audience.length === 0}
            onPress={() => setAudience([])}
          >
            <Badge
              tone={tones.audience.team}
              text={audience.length === 0 ? 'Your business only ✓' : 'Your business only'}
            />
          </Pressable>
          {homeowners.map((h) => {
            const on = audience.includes(h.userId);
            return (
              <Pressable
                key={h.userId}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                aria-checked={on}
                onPress={() => toggle(h.userId)}
              >
                <Badge
                  tone={
                    on
                      ? tones.audience.shared
                      : { ...tones.audience.shared, bg: p.panel, fg: p.ink3 }
                  }
                  text={`${h.displayName.split(' ')[0]}${on ? ' ✓' : ''}`}
                />
              </Pressable>
            );
          })}
          {homeowners.length > 1 ? (
            <Button
              title="Everyone"
              kind="quiet"
              onPress={() => setAudience(homeownerIds(members))}
            />
          ) : null}
        </Row>
        <Muted>{audienceLabel(audience, members)}</Muted>
      </View>

      {problem ? <Text style={styles.error}>{problem}</Text> : null}
      <Row style={{ justifyContent: 'flex-end' }}>
        <Button
          title={busy && files.length ? 'Uploading…' : 'Post'}
          glyph="↑"
          onPress={submit}
          disabled={busy || !valid}
        />
      </Row>
    </Card>
  );
}

/**
 * Ask the homeowner(s) to approve an item. Re-using the approvalId after "request changes" is
 * what makes it a revised round of the same question rather than a new one.
 */
function AskApproval({
  item,
  members,
  round,
  existingApprovalId,
  onPost,
  onCancel,
}: {
  item: Item;
  members: ProjectMember[];
  round: number;
  existingApprovalId?: Id;
  onPost: (e: NewEvent) => Promise<void>;
  onCancel: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [question, setQuestion] = useState(item.name);
  const [body, setBody] = useState('');
  const [days, setDays] = useState('7');
  const [audience, setAudience] = useState<Id[]>(() => homeownerIds(members));
  const [busy, setBusy] = useState(false);
  const homeowners = members.filter((m) => m.role === 'homeowner');
  const toggle = (id: Id) =>
    setAudience((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const valid = question.trim().length > 0 && audience.length > 0;
  return (
    <Card style={{ gap: space.md }} focusKey={`form:ask:${item.id}`}>
      <Text style={styles.h2}>
        {round > 1
          ? `Ask again about ${item.name} (round ${round})`
          : `Ask for approval: ${item.name}`}
      </Text>
      <Field
        label="What are you asking them to approve?"
        value={question}
        onChangeText={setQuestion}
        placeholder="e.g. Grout colour for the floor tile: Warm Gray"
      />
      <Field
        label="Details — say where it goes and what the choice is"
        value={body}
        onChangeText={setBody}
        multiline
        placeholder="e.g. For the joints in the floor tile. Warm Gray hides dirt; Bright White matches the walls."
      />
      <View style={{ width: 200 }}>
        <Field
          label="Decide within (days)"
          value={days}
          onChangeText={setDays}
          keyboardType="number-pad"
        />
      </View>
      <View style={{ gap: space.xs }}>
        <Text style={styles.label}>Who decides</Text>
        <Row wrap>
          {homeowners.map((h) => {
            const on = audience.includes(h.userId);
            return (
              <Pressable
                key={h.userId}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                aria-checked={on}
                onPress={() => toggle(h.userId)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {h.displayName.split(' ')[0]}
                  {on ? ' ✓' : ''}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      </View>
      <Muted>
        {item.clientPrice !== undefined ? `Amount shown: ${money(item.clientPrice)}. ` : ''}
        The item shows as “Proposed” until they answer.
      </Muted>
      <Row wrap style={{ justifyContent: 'flex-end' }}>
        <Button title="Cancel" kind="quiet" onPress={onCancel} />
        <Button
          title={round > 1 ? 'Send revised request' : 'Send request'}
          glyph="?"
          disabled={busy || !valid}
          onPress={async () => {
            setBusy(true);
            try {
              await onPost({
                projectId: item.projectId,
                kind: 'approval_requested',
                approvalId: existingApprovalId ?? newId('appr'),
                title: question.trim(),
                dueBy: addDays(new Date().toISOString(), Number(days) || 7),
                amount: item.clientPrice,
                itemId: item.id,
                audience,
                body: body.trim() || undefined,
                refs: [{ kind: 'item', id: item.id, label: item.name }],
              });
            } finally {
              setBusy(false);
            }
          }}
        />
      </Row>
    </Card>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    h1: { ...type.h1, color: p.ink },
    label: { ...type.label, color: p.ink3 },
    h2: { ...type.h2, color: p.ink },
    chipTextOn: { color: p.onAccent },
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
