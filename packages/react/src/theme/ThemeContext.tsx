/**
 * 主题上下文：运行时切换（ADR-0003 决策 2「主题 = 令牌集，不是三套组件」）。
 * useTheme() 消费当前 TokenSet 与 setTheme；主题切换 = 换令牌，组件零重挂载。
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_THEME, THEMES } from './tokens.js';
import type { ThemeId, TokenSet } from './types.js';

interface ThemeContextValue {
  /** 当前主题令牌（渲染核心唯一读取入口） */
  token: TokenSet;
  /** 切换主题（classic / sticker / glass） */
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** 主题提供者：挂在应用根部；initial 可选（默认 glass，ADR-0003 决策 4） */
export function ThemeProvider({
  initial = DEFAULT_THEME,
  children,
}: {
  initial?: ThemeId;
  children: ReactNode;
}) {
  const [id, setId] = useState<ThemeId>(initial);
  const token = THEMES[id];
  const setTheme = useCallback((next: ThemeId) => setId(next), []);
  const value = useMemo(() => ({ token, setTheme }), [token, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** 消费当前主题令牌；必须在 ThemeProvider 内使用 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 <ThemeProvider> 内使用');
  return ctx;
}
