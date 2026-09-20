import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, type ScrollView, type View } from 'react-native';
import type { Ref } from '../model/types';

/**
 * "Jump to the thing." Every reference in the app — a concierge source, a digest line, an item
 * name in a timeline entry — is a link. Pressing it scrolls the page to that entry or item and
 * highlights it for a moment. Cards register themselves by key; the provider does the rest.
 *
 * Keys are `item:<id>` and `event:<id>`.
 */
export const refKey = (r: Pick<Ref, 'kind' | 'id'>) => `${r.kind}:${r.id}`;

type FocusValue = {
  focused?: string;
  focus: (key: string) => void;
  register: (key: string, node: View | null) => void;
  /** The screen's ScrollView, so the provider can scroll to a registered node. */
  attachScroller: (scroller: ScrollView | null) => void;
  /**
   * A screen with tabs registers a router: given a key, it switches to the tab that holds the
   * target. The provider then waits for the card to mount before scrolling.
   */
  addRouter: (router: (key: string) => void) => () => void;
};

const FocusCtx = createContext<FocusValue | undefined>(undefined);

/** On the web a node inside a `display: none` tab has no boxes yet; elsewhere trust the mount. */
function isLaidOut(node: View): boolean {
  if (Platform.OS !== 'web') return true;
  const el = node as unknown as { getClientRects?: () => { length: number } };
  return el.getClientRects ? el.getClientRects().length > 0 : true;
}

export function FocusProvider({ children }: { children: React.ReactNode }) {
  const nodes = useRef(new Map<string, View>());
  const scroller = useRef<ScrollView | null>(null);
  const routers = useRef(new Set<(key: string) => void>());
  const [focused, setFocused] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const register = useCallback((key: string, node: View | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  }, []);
  const attachScroller = useCallback((s: ScrollView | null) => {
    scroller.current = s;
  }, []);
  const addRouter = useCallback((router: (key: string) => void) => {
    routers.current.add(router);
    return () => {
      routers.current.delete(router);
    };
  }, []);

  const scrollTo = useCallback((node: View) => {
    if (Platform.OS === 'web') {
      // On the web a View ref is the DOM element itself.
      (node as unknown as { scrollIntoView?: (o: object) => void }).scrollIntoView?.({
        behavior: 'smooth',
        block: 'center',
      });
    } else if (scroller.current) {
      const container = scroller.current.getInnerViewNode?.() ?? scroller.current;
      node.measureLayout(
        container as never,
        (_x, y) => scroller.current?.scrollTo({ y: Math.max(0, y - 24), animated: true }),
        () => undefined,
      );
    }
  }, []);

  const focus = useCallback(
    (key: string) => {
      // Let the screen switch tabs first. The target may sit on a hidden tab (mounted but not
      // laid out) or not be mounted at all yet, so wait until it has a size before scrolling.
      for (const r of routers.current) r(key);
      let tries = 0;
      const attempt = () => {
        const node = nodes.current.get(key);
        if (node && isLaidOut(node)) scrollTo(node);
        else if (tries++ < 10) setTimeout(attempt, 60);
      };
      setTimeout(attempt, 0);
      setFocused(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFocused(undefined), 2600);
    },
    [scrollTo],
  );

  useEffect(() => () => timer.current && clearTimeout(timer.current), []);

  const value = useMemo(
    () => ({ focused, focus, register, attachScroller, addRouter }),
    [focused, focus, register, attachScroller, addRouter],
  );
  return <FocusCtx.Provider value={value}>{children}</FocusCtx.Provider>;
}

export function useFocus(): FocusValue {
  const v = useContext(FocusCtx);
  if (!v) throw new Error('useFocus must be used inside <FocusProvider>.');
  return v;
}

/** For a screen with tabs: switch to the tab that holds a key before the provider scrolls to it. */
export function useFocusRouter(router: (key: string) => void) {
  const { addRouter } = useFocus();
  const latest = useRef(router);
  latest.current = router;
  useEffect(() => addRouter((key) => latest.current(key)), [addRouter]);
}

/** For a card: `const { ref, isFocused } = useFocusTarget('item:abc')` then `<View ref={ref}>`. */
export function useFocusTarget(key: string) {
  const { register, focused } = useFocus();
  const ref = useCallback((node: View | null) => register(key, node), [register, key]);
  return { ref, isFocused: focused === key };
}
