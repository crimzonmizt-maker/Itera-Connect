import { Platform, Share } from 'react-native';
import type { Invitation } from '../model/types';

/**
 * Where people open the app: on the web, the page this is running on (so a link made on the
 * hosted test site points back at it); in the phone app, EXPO_PUBLIC_APP_URL if set.
 */
export function appUrl(): string | undefined {
  if (Platform.OS === 'web' && typeof window !== 'undefined')
    return `${window.location.origin}${window.location.pathname}`;
  return process.env.EXPO_PUBLIC_APP_URL || undefined;
}

/** The invitation as a message: a link that opens the invitation door with the code filled in. */
export function invitationMessage(inv: Pick<Invitation, 'code' | 'email'>, url = appUrl()) {
  const spaced = `${inv.code.slice(0, 4)} ${inv.code.slice(4)}`;
  const link = url ? `${url}?invite=${inv.code}` : undefined;
  return [
    'You are invited to follow your project on Itera Connect.',
    link ? `Open ${link}` : undefined,
    `Sign up with ${inv.email} and the code ${spaced}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Hand the invitation to the phone's share sheet (text, e-mail, WhatsApp…). A desktop browser
 * without one gets it copied instead. Returns what happened so the screen can say so.
 */
export async function shareInvitation(
  inv: Pick<Invitation, 'code' | 'email'>,
): Promise<'shared' | 'copied' | 'failed'> {
  const message = invitationMessage(inv);
  try {
    if (Platform.OS === 'web') {
      const nav = globalThis.navigator as Navigator | undefined;
      if (nav?.share) {
        await nav.share({ text: message });
        return 'shared';
      }
      await nav?.clipboard?.writeText(message);
      return 'copied';
    }
    await Share.share({ message });
    return 'shared';
  } catch {
    return 'failed';
  }
}
