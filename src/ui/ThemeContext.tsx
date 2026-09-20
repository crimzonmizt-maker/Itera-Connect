import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { makeTones, palettes, type Palette, type SchemeName, type Tones } from './theme';

/** What the person asked for. `system` follows the device; the others pin a scheme. */
export type ThemePreference = 'system' | SchemeName;

type ThemeValue = {
  palette: Palette;
  tones: Tones;
  scheme: SchemeName; // what is actually showing
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
};

const STORAGE_KEY = 'ic.theme';
const ThemeCtx = createContext<ThemeValue | undefined>(undefined);

export function ThemeProvider({
  children,
  initial = 'system',
}: {
  children: React.ReactNode;
  initial?: ThemePreference;
}) {
  const system = useColorScheme();
  const [preference, setPref] = useState<ThemePreference>(initial);

  // Remember the choice on this device. Best effort: storage can be unavailable in previews.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPref(v);
      })
      .catch(() => undefined);
  }, []);
  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => undefined);
  }, []);

  const scheme: SchemeName =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const value = useMemo<ThemeValue>(() => {
    const palette = palettes[scheme];
    return { palette, tones: makeTones(palette), scheme, preference, setPreference };
  }, [scheme, preference, setPreference]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return v;
}

/**
 * Styles that depend on the palette. Pass a module-level factory so the memo holds:
 *   const makeStyles = (p: Palette) => StyleSheet.create({ ... });
 *   const styles = useStyles(makeStyles);
 */
export function useStyles<T>(factory: (p: Palette) => T): T {
  const { palette } = useTheme();
  return useMemo(() => factory(palette), [factory, palette]);
}
