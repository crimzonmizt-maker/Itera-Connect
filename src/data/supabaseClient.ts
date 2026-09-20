import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

/** Same rule Itera uses: only an https *.supabase.co URL and a publishable (public) key are accepted. */
export function validAuthConfig(candidateUrl: string, candidateKey: string): boolean {
  try {
    const parsed = new URL(candidateUrl);
    return (
      parsed.protocol === 'https:' &&
      /^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) &&
      parsed.pathname === '/' &&
      !parsed.search &&
      /^sb_publishable_[A-Za-z0-9_-]+$/.test(candidateKey)
    );
  } catch {
    return false;
  }
}

export const supabaseConfigured = validAuthConfig(url, key);

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!supabaseConfigured)
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and the publishable key.',
    );
  if (!client) {
    client = createClient(url, key, {
      auth: {
        storage: AsyncStorage,
        storageKey: 'itera-connect-auth-v1',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
        flowType: 'pkce',
      },
    });
    if (Platform.OS !== 'web') {
      AppState.addEventListener('change', (state) => {
        if (state === 'active') client?.auth.startAutoRefresh();
        else client?.auth.stopAutoRefresh();
      });
    }
  }
  return client;
}
