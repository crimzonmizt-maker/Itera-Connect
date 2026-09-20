import type { IsoDate, Money } from './types';

export const money = (cents: Money) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/**
 * "1,840" / "$1,840.00" / "1840.5" → cents. Returns undefined for blank or unreadable input,
 * so a form can tell "left empty" from "typed zero".
 */
export function parseMoney(text: string): Money | undefined {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (cleaned === '') return undefined;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return undefined;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

/** Dollars for an input box: 184000 → "1840.00". */
export const moneyInput = (cents: Money | undefined) =>
  cents === undefined ? '' : (cents / 100).toFixed(2);

export const shortDate = (iso: IsoDate) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export const longDate = (iso: IsoDate) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export const daysBetween = (from: IsoDate, to: IsoDate) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);

export const addDays = (iso: IsoDate, days: number): IsoDate =>
  new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

/** Stable, URL-safe ids without a dependency. crypto.randomUUID exists on web, Node 19+ and Hermes. */
export const newId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;

/** Invitation codes avoid 0/O and 1/I so they survive being read out over the phone. */
export function newInviteCode(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[Math.floor(random() * alphabet.length)];
  return code;
}

export const validInviteCode = (code: string) =>
  /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code.trim().toUpperCase());

/** "box" → "boxes", "bag" → "bags", "each" stays. Good enough for building materials. */
export function plural(unit: string, count: number): string {
  if (count === 1 || unit === 'each' || unit === 'sq ft') return unit;
  if (/(s|x|ch|sh)$/.test(unit)) return `${unit}es`;
  return `${unit}s`;
}
