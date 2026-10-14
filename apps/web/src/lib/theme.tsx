import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const KEY = 'memento:theme';
const Ctx = createContext<{ dark: boolean; setDark: (d: boolean) => void }>({ dark: false, setDark: () => {} });

function initial(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return v === 'dark';
  } catch {
    /* storage blocked */
  }
  return false;
}

/** Dark mode is a per-device choice. It dims the room, not the pages. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDarkState] = useState(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#171411' : '#2B2621');
  }, [dark]);
  const setDark = useCallback((d: boolean) => {
    setDarkState(d);
    try {
      localStorage.setItem(KEY, d ? 'dark' : 'light');
    } catch {
      /* storage blocked */
    }
  }, []);
  return <Ctx.Provider value={{ dark, setDark }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
