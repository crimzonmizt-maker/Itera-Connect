import { useCallback, useEffect, useMemo, useState } from 'react';
import { partitionSuggestions } from '../concierge/dismissals';
import { allSuggestions } from '../concierge/rules';
import type { ItemInput, ProjectRepository, RoomInput } from '../data/repository';
import { approvals, openApprovals, projectProgress } from '../model/progress';
import type {
  Id,
  Item,
  NewEvent,
  Project,
  ProjectEvent,
  ProjectMember,
  Room,
  Viewer,
  Decision,
} from '../model/types';

/** Loads a project for the current viewer and keeps it fresh. Screens read; they never fetch. */
export function useProject(
  repo: ProjectRepository,
  projectId: Id,
  now: () => string = () => new Date().toISOString(),
) {
  const [viewer, setViewer] = useState<Viewer>();
  const [project, setProject] = useState<Project>();
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [v, p, e, i, r, m] = await Promise.all([
        repo.viewer(),
        repo.getProject(projectId),
        repo.listEvents(projectId),
        repo.listItems(projectId),
        repo.listRooms(projectId),
        repo.listMembers(projectId),
      ]);
      setViewer(v);
      setProject(p);
      setEvents(e);
      setItems(i);
      setRooms(r);
      setMembers(m);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the project.');
    } finally {
      setLoading(false);
    }
  }, [repo, projectId]);

  useEffect(() => {
    void refresh();
    return repo.subscribe(projectId, () => void refresh());
  }, [repo, projectId, refresh]);

  const progress = useMemo(() => projectProgress(events), [events]);
  const open = useMemo(() => openApprovals(events), [events]);
  const approvalList = useMemo(() => approvals(events), [events]);
  // Rules say what is true now; the dismissal entries say what the contractor set aside.
  const suggestions = useMemo(
    () =>
      viewer?.role === 'contractor'
        ? partitionSuggestions(
            allSuggestions({ projectId, events, items, members, now: now() }),
            events,
            now(),
          )
        : { active: [], archived: [] },
    [viewer, projectId, events, items, members, now],
  );

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through.');
    }
  };

  return {
    viewer,
    project,
    events,
    items,
    rooms,
    members,
    error,
    loading,
    progress,
    now: now(),
    openApprovals: open,
    approvals: approvalList,
    suggestions,
    post: (event: NewEvent) => act(() => repo.appendEvent(event)),
    reply: (eventId: Id, body: string) => act(() => repo.reply(projectId, eventId, body)),
    decide: (approvalId: Id, decision: Decision, note?: string) =>
      act(() => repo.decideApproval(projectId, approvalId, decision, note)),
    invite: (email: string) => repo.createInvitation(projectId, email),
    // Throws on failure so the form can show the error next to the field and stay open.
    saveItem: async (item: ItemInput) => {
      const saved = await repo.upsertItem(projectId, item);
      await refresh();
      return saved;
    },
    saveRoom: async (room: RoomInput) => {
      const saved = await repo.upsertRoom(projectId, room);
      await refresh();
      return saved;
    },
    clearError: () => setError(undefined),
  };
}

export type ProjectState = ReturnType<typeof useProject>;
