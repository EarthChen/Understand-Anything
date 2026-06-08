// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { I18nProvider } from '../../contexts/I18nContext.tsx';
import { useDashboardShortcuts } from '../useDashboardShortcuts';

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(I18nProvider, { language: 'en', children });
}

describe('useDashboardShortcuts', () => {
  it('returns a shortcuts array with expected categories', () => {
    const { result } = renderHook(() => useDashboardShortcuts(), { wrapper });
    const categories = new Set(result.current.shortcuts.map((s) => s.category));
    expect(categories).toContain('General');
    expect(categories).toContain('Navigation');
    expect(categories).toContain('Tour');
    expect(categories).toContain('View');
  });

  it('includes help toggle shortcut', () => {
    const { result } = renderHook(() => useDashboardShortcuts(), { wrapper });
    const helpShortcut = result.current.shortcuts.find(
      (s) => s.key === '?' && s.shiftKey,
    );
    expect(helpShortcut).toBeDefined();
    expect(helpShortcut!.category).toBe('General');
  });

  it('includes escape shortcut', () => {
    const { result } = renderHook(() => useDashboardShortcuts(), { wrapper });
    const esc = result.current.shortcuts.find((s) => s.key === 'Escape');
    expect(esc).toBeDefined();
    expect(esc!.category).toBe('Navigation');
  });

  it('showKeyboardHelp starts as false', () => {
    const { result } = renderHook(() => useDashboardShortcuts(), { wrapper });
    expect(result.current.showKeyboardHelp).toBe(false);
  });

  it('setShowKeyboardHelp toggles the state', () => {
    const { result } = renderHook(() => useDashboardShortcuts(), { wrapper });
    act(() => result.current.setShowKeyboardHelp(true));
    expect(result.current.showKeyboardHelp).toBe(true);
    act(() => result.current.setShowKeyboardHelp(false));
    expect(result.current.showKeyboardHelp).toBe(false);
  });

  it('help shortcut action toggles showKeyboardHelp', () => {
    const { result } = renderHook(() => useDashboardShortcuts(), { wrapper });
    const helpShortcut = result.current.shortcuts.find(
      (s) => s.key === '?' && s.shiftKey,
    )!;
    expect(result.current.showKeyboardHelp).toBe(false);
    act(() => helpShortcut.action());
    expect(result.current.showKeyboardHelp).toBe(true);
    act(() => helpShortcut.action());
    expect(result.current.showKeyboardHelp).toBe(false);
  });

  it('shortcuts array is stable across rerenders (useMemo)', () => {
    const { result, rerender } = renderHook(() => useDashboardShortcuts(), { wrapper });
    const first = result.current.shortcuts;
    rerender();
    expect(result.current.shortcuts).toBe(first);
  });
});
