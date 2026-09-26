// What a person reads when something is refused. The database and Supabase Auth answer in codes
// ("IC_ALREADY_DECIDED", "Invalid login credentials"); nobody should have to read those.

const messages: [RegExp, string][] = [
  [
    /IC_INVITE_INVALID/,
    'That code does not match an open invitation for this e-mail address. Check both with your contractor — codes last 14 days and work once.',
  ],
  [
    /IC_ALREADY_DECIDED/,
    'That question has already been answered. Pull down or reopen the project to see the latest.',
  ],
  [/IC_APPROVAL_MISSING/, 'That approval request no longer exists.'],
  [/IC_HOMEOWNER_KIND/, 'Homeowners can post notes and photos; the contractor posts the rest.'],
  [/IC_AUDIENCE_NOT_MEMBER/, 'One of the people you picked is no longer on this project.'],
  [/IC_ITEM_NOT_ON_PROJECT/, 'That item belongs to a different project.'],
  [/IC_ROOM_NOT_ON_PROJECT/, 'That room belongs to a different project.'],
  [/IC_ROOM_NAME_TAKEN/, 'There is already a room with that name on this project.'],
  [/IC_ROOM_NAME_REQUIRED/, 'Give the room a name.'],
  [
    /IC_PLAN_LIMIT/,
    'Your plan does not include another project. Ask Itera to move your account to Pro.',
  ],
  [
    /IC_EVENT_DATA|IC_EVENT_KIND/,
    'That entry is missing something it needs. Check the fields and try again.',
  ],
  [
    /insufficient_privilege|permission denied|row-level security/i,
    'You do not have access to do that on this project.',
  ],
  [/invalid login|invalid credentials/i, 'That e-mail and password did not match.'],
  [/email not confirmed/i, 'Confirm your e-mail first — open the link we sent you, then sign in.'],
  [
    /already registered|already exists/i,
    'An account with this e-mail already exists. Sign in instead.',
  ],
  [
    /password should be at least|weak password/i,
    'Choose a longer password — at least 8 characters.',
  ],
  [/rate limit|too many requests/i, 'Too many tries in a short time. Wait a minute and try again.'],
  [
    /approved contractors and invited homeowners/i,
    'This address has not been invited. Ask your contractor to send an invitation.',
  ],
  [
    /payload too large|exceeded the maximum allowed size|entity too large/i,
    'That file is too big. The limit is 25 MB.',
  ],
  [
    /mime type .* is not supported|invalid mime/i,
    'That kind of file is not accepted. Photos (JPG, PNG, HEIC) and PDFs are.',
  ],
  [
    /network|failed to fetch|fetch failed|timeout/i,
    'Could not connect. Check your connection and try again.',
  ],
];

export function friendlyError(
  e: unknown,
  fallback = 'That did not go through. Please try again.',
): string {
  const text =
    e instanceof Error
      ? e.message
      : typeof e === 'object' && e !== null && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e);
  for (const [pattern, message] of messages) if (pattern.test(text)) return message;
  return fallback;
}
