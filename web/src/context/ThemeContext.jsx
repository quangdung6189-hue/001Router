import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'r001-color-scheme';
const ThemeContext = createContext(null);

function getSystemScheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredTheme() {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') return val;
  } catch {
    // Storage blocked
  }
  return 'dark';
}

function applySchemeToDocument(mode, systemScheme) {
  const metaContent = mode === 'system' ? 'light dark' : mode;
  const resolved = mode === 'system' ? systemScheme : mode;

  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute('content', metaContent);
  }
  document.documentElement.dataset.theme = resolved;

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.setAttribute('content', resolved === 'light' ? '#FDFAF6' : '#1a1a1a');
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => readStoredTheme());
  const [systemScheme, setSystemScheme] = useState(() => getSystemScheme());

  const resolvedTheme = theme === 'system' ? systemScheme : theme;

  // Listen to OS color-scheme changes
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemScheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Apply to <meta name="color-scheme"> and data-theme
  useEffect(() => {
    applySchemeToDocument(theme, systemScheme);
  }, [theme, systemScheme]);

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) {
        setThemeState(readStoredTheme());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((nextMode) => {
    const valid = nextMode === 'light' || nextMode === 'dark' || nextMode === 'system' ? nextMode : 'dark';
    setThemeState(valid);
    try {
      localStorage.setItem(STORAGE_KEY, valid);
    } catch {
      // Theme still applies in memory even if storage is blocked
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }, [resolvedTheme, setTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, systemScheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, systemScheme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
