// Plans. The database is the one that enforces them (ic_create_project refuses a Free account
// over its limit); this only decides what the app SAYS before anyone taps, so nobody fills in a
// whole form just to be told no.
import type { Account } from './types';

export type ProjectGate = { allowed: boolean; note?: string };

/**
 * May this account start another project, and what should the screen say about it?
 *   account        — undefined while it is still loading, or in the sample project
 *   ownedProjects  — projects this person's business already has (not ones they were invited to)
 */
export function newProjectGate(account: Account | undefined, ownedProjects: number): ProjectGate {
  // TODO(human): decide what the app says for each plan. The field test runs everyone on Pro, so
  // until this is written every account is allowed and nothing is shown.
  void account;
  void ownedProjects;
  return { allowed: true };
}
