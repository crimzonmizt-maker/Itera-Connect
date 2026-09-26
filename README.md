# Itera Connect

One project record, two windows into it. The contractor runs the project and sees everything;
the homeowners they invite each see exactly what was addressed to them, approve what needs
approving, and ask questions that stay attached to the thing they are about. A rules-based
concierge watches the record and proposes — never acts — and every suggestion says where it
came from.

This is the foundation described in the Itera audit: the part that must exist before the
homeowner experience, the shared timeline, and any AI helper can be built on top. The drawing
engine (floor plans, elevations, tile layouts, PDFs) stays in the Itera repository for now and
will be brought over as the contractor's "plans" tab once its types are extracted (see the
audit's step 2, already done on a branch there).

## Run it

```sh
npm ci
npm run web          # http://127.0.0.1:8090 — sample project, no account needed
npm run typecheck
npm run lint
npm test
DATABASE_URL=postgres://... npm run test:sql   # scratch Postgres only; proves the database rules
```

**Try it without installing anything:** every push to `main` builds the web version and puts it
on GitHub Pages (`.github/workflows/pages.yml`) at `https://<owner>.github.io/Itera-Connect/`. It is
the same sample project described below — open it on a phone or laptop, switch between Mike, Dana
and Sam, click around. Nothing typed there is saved: it runs on in-memory sample data until a
Supabase project is configured, and a page reload starts over.

With no Supabase settings, the app shows a fictional project and a switch to view it as the
contractor (Mike) or either homeowner (Dana, Sam). That mode is for development and demos; it
applies the same visibility rules the database enforces, so what you see is what a real
homeowner would see — including that Sam does not see the approval that was addressed to Dana.

To run against a real backend, copy `.env.example` to `.env.local`, fill in an `https://*.supabase.co`
URL and an `sb_publishable_*` key, and apply the files in `supabase/migrations/` in order (or paste
them, in order, into the Supabase SQL editor). `supabase/tests/run.sh` applies the migrations
and runs the checks in `supabase/tests/`, which prove the rules that matter most (below) against
a real Postgres. CI does this on every push; locally point `DATABASE_URL` at a scratch database,
never production.

### Field test

The hosted web build becomes the real app when the repository variables
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are set (GitHub →
Settings → Secrets and variables → Actions → Variables); push to `main` and every tester opens
the same link. In Supabase, set **Authentication → URL Configuration → Site URL** to that link so
confirmation and password-reset e-mails come back to it.

- **Anyone can sign up as a contractor** while `ic_config.open_signup` is true (the default). The
  Before User Created hook is not needed for the field test; switch `open_signup` off and turn the
  hook on when sign-up should be by approval again.
- **Plans.** Every account is `free` or `pro`. Accounts follow `ic_config.default_plan` (`pro`)
  unless set individually: `select public.ic_set_plan('someone@example.com', 'free');` in the SQL
  editor. A Free account may own `ic_config.free_project_limit` projects (1); the database
  refuses the next one. Only the SQL editor can change plans.
- **Files.** Photos and PDFs (25 MB each) go in the private `ic-files` bucket under
  `<project id>/…`. The team can open every file on its projects; a homeowner can open a file only
  through an entry addressed to them that points at it. Files cannot be changed or deleted once
  posted.

## How it is put together

```
src/model/        the shared record: types, visibility rules, rooms, progress/approvals derived from events
src/concierge/    rules that read the event spine and propose (overdue approvals, lead-time
                  collisions, short deliveries, weekly digest draft). Pure functions, tested.
src/data/         ProjectRepository interface; LocalRepository (sample data) and
                  SupabaseRepository (real). Both return data already filtered for the viewer.
src/ui/           theme tokens and components. No hex literals outside theme.ts.
src/screens/      ContractorHome, HomeownerHome, ProjectHeader, ItemForm, NewProject, SignIn, useProject.
supabase/         schema, row-level security, write functions, and a permission test.
tests/            node:test suites run by `npm test`.
```

Rules the code keeps:

- **The model imports no React.** Anything in `src/model` or `src/concierge` runs in Node, in
  the browser, on a phone, or later in a server function.
- **Screens never filter.** A homeowner screen renders whatever the repository hands it. The
  repository (in memory) or the database (in production) decides what that is. If a screen
  ever needs `if (role === 'homeowner') hide(...)`, the model is wrong, not the screen.
- **Every entry has an audience** — the member ids who may see it; empty means the business team
  only. A badge always says _who_ ("Shared with Dana, Sam"), never just "shared". A decision is
  seen by exactly the people who were asked. Homeowners cannot pick an audience: their posts go
  to the team and every homeowner on the project. **Files follow the entry**: a photo or PDF is
  readable by exactly the people who can see the entry it is attached to — enforced by the
  storage rules in the database, not the screen.
- **The role is per project.** Someone who runs a business is the contractor on its projects and a
  homeowner on any project they were invited to (`roleOn` in `model/types.ts`).
- **Rooms are records, not labels.** A project has rooms; items point at one (or none — a permit
  has no room). The contractor names a room however they like; the app keeps a separate `type`
  (bathroom, kitchen, …) for lookups, guessed from the name and marked as a guess until the
  contractor confirms it. Nothing is ever decided on an unconfirmed guess. Rooms are where the
  task hierarchy (project → room → task) and, later, a contractor's usual materials per room
  type will hang — the profile itself is deliberately not built yet. (`model/rooms.ts`)
- **Items follow the buyer.** Each project has an engagement mode (`all_in`, `labor_only`,
  `hybrid`) that sets the default for who purchases and whether client prices show; each item can
  override it. A homeowner sees supplier, SKU, order number and lead time only for items _they_
  buy (or the contractor chose to share); supplier cost and internal notes never leave the
  business. Homeowners read items through the `ic_items_v` view, which nulls those columns in
  the database — not in the app.
- **Documents that leave by e-mail are recorded.** Measurements and quotes still go out as PDFs
  with the layers the contractor chose; a `document_sent` entry keeps the record complete.
- **Every reference is a link.** Concierge sources, digest lines, item names in entries, "open
  the request" on an approval — all jump to the entry or item and highlight it (FocusContext).
  Notes the concierge drafts carry the same references (`refs` on the entry), so the posted
  update is a list of links, not a wall of text. A future language model has to cite the same way.
- **Request changes keeps the question open — and the contractor has three honest answers.** The
  homeowner says what to change; the item shows "Change requested"; the card stays on their list
  as "waiting on the contractor" and moves to the contractor's concierge. From that card (or the
  entry itself) the contractor can _Reply_ (threaded under the change request), _Revise and ask
  again_ (opens the approval form for that item — same approvalId, round 2, which reopens it for
  the homeowner) or _Withdraw request_ (a `withdrawn` decision only the contractor can post: the
  question closes, the item returns to Proposed, the note goes to whoever was asked). Only
  "approved" or "withdrawn" closes a question; nothing can follow either.
- **Dismiss is not delete.** Setting a concierge card aside posts a business-only `dismissal`
  entry; the card moves to "Set aside" with Restore, and comes back on its own — urgent the next
  day, attention after three, info only when restored. On or after its due date it cannot be
  dismissed, only snoozed for a chosen number of days, and that choice is on the record too.
  Sending a drafted reminder logs "acted" on the same terms. (`concierge/dismissals.ts`)
- **Where is it.** Every item card shows ordered / expected / delivered from the event spine
  (`model/logistics.ts`), with a warning when it lands after the job that needs it — the same
  arithmetic the concierge uses, so both sides see the same date.
- **One screen, two tabs, nothing lost between them.** Both roles get the same shape: a header
  (project, who runs it, "Shared with …" — which, for the contractor, is where _Add user to
  project_ lives), progress first, then _Overview_ / _Selections & materials_ (homeowner: _What is
  happening_ / _Your selections_). Tab bodies stay mounted but hidden (`TabPane`), so a half-typed
  note or an open item form survives a look at the other tab. The concierge shows one card at a
  time (‹ 2 of 7 ›, with a severity strip and _Show all_); a jump to an item switches tabs on its
  own (`useFocusRouter`) and scrolls once the target has a size.
- **Writes go through database functions** that re-check the caller. Clients hold only a public key.
- **The concierge proposes.** Accepting a suggestion posts an ordinary event under the
  contractor's name. Nothing is sent to the homeowner without a person choosing to send it.
- **Money is whole cents**, never a float.
- **Status is never colour alone, and copy never names a colour.** Every badge carries a glyph
  and a label. Light and dark schemes live in `src/ui/theme.ts`; `scripts/palette-check.py`
  (run in CI) fails the build if any text/background pair drops under 4.5:1 or the four status
  hues come closer than 16 ΔE under protan, deutan or tritan simulation. Components read colours
  through `useTheme()`, so a user-chosen scheme later is one more entry in `palettes`.

## Who owns what

The contractor's **business** is the account. Projects belong to the business; one person owns
one business, and a contractor sees every project of their business and nobody else's. Each
homeowner is a **member of a project**, created when they redeem the invitation code the
contractor gave them; a project can have more than one (a couple, a landlord and tenant), and a
homeowner can be on several projects. During the field test anyone may sign up; otherwise sign-up
is refused for anyone who is neither an approved contractor nor the holder of a live invitation.

## What the contractor can do today

Sign up and create a business and project (mode chosen with a plain-language explanation), set
the start and target dates, plan tasks with due dates and move them through Start / Update /
Done (an Update is its own entry and leaves the task where it is), schedule and reschedule jobs on
a typed date, add and edit items (model / SKU / part number, supplier, lead time) with a live "the
homeowner will see…" preview, invite homeowners and send the invitation as a link through the
phone's share sheet, post updates with photos and PDFs to a chosen audience and link them to an
item, and act on concierge suggestions — including sending the reminders it drafts. The homeowner
joins with the link or code (on any device; if Supabase asks them to confirm their e-mail first,
the code is redeemed at their first sign-in), approves, replies to entries, sends photos and PDFs
back, and sees their own list of things to order. Both can reset a forgotten password, sign out
and back in, and switch between all the projects they are on.

## What is deliberately not here yet

- The drawing engine and the product catalogue (they live in Itera; the catalogue needs to
  become data before it moves).
- A language-model layer on the concierge. The rules produce the facts; a model can later
  reword them or answer free-text questions **from** them. It should never be asked to remember
  the project on its own.
- Push notifications and e-mail alerts: changes appear live while the app is open (realtime),
  but nobody is told when it is closed. Also not yet: payment milestones, removing a member,
  cancelling an invitation.
- Generating the PDFs themselves (that is Itera's engine); Connect only records that one was sent.

## Relationship to Itera

Itera 1.5.6 is a single-designer drafting tool with one workspace per account. Itera Connect is
the shared-record product that the audit said needed to sit underneath the homeowner/contractor
goal. They share the Supabase project and the same security style (row-level security plus
SECURITY DEFINER functions, no service-role key in any client); table names are prefixed `ic_`
so both can live in one database while the engine is moved across.
