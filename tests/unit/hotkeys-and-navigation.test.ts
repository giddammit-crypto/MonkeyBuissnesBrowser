import { describe, expect, it } from 'vitest';
import type { OmniboxSuggestion } from '../../src/shared/omniboxSuggestions';

describe('Hotkeys and Chromium Shortcuts logic', () => {
  describe('Tab cycling arithmetic (Ctrl+Tab / Ctrl+Shift+Tab)', () => {
    function getNextTabIndex(currentIdx: number, totalTabs: number, isShift: boolean): number {
      if (totalTabs <= 0) return -1;
      const delta = isShift ? -1 : 1;
      return (currentIdx + delta + totalTabs) % totalTabs;
    }

    it('cycles forward across tabs with wrap-around', () => {
      const total = 4;
      expect(getNextTabIndex(0, total, false)).toBe(1);
      expect(getNextTabIndex(1, total, false)).toBe(2);
      expect(getNextTabIndex(2, total, false)).toBe(3);
      expect(getNextTabIndex(3, total, false)).toBe(0); // wraps back to first
    });

    it('cycles backward across tabs with wrap-around (Shift+Tab)', () => {
      const total = 4;
      expect(getNextTabIndex(0, total, true)).toBe(3); // wraps to last
      expect(getNextTabIndex(3, total, true)).toBe(2);
      expect(getNextTabIndex(2, total, true)).toBe(1);
      expect(getNextTabIndex(1, total, true)).toBe(0);
    });

    it('handles single tab edge case gracefully', () => {
      expect(getNextTabIndex(0, 1, false)).toBe(0);
      expect(getNextTabIndex(0, 1, true)).toBe(0);
    });
  });

  describe('Chromium Hard Reload shortcut rules', () => {
    function isHardReloadEvent(e: { ctrlOrCmd: boolean; shiftKey: boolean; key: string }): boolean {
      const key = e.key.toLowerCase();
      return (
        (e.ctrlOrCmd && e.shiftKey && key === 'r') ||
        (e.ctrlOrCmd && key === 'f5') ||
        (e.shiftKey && key === 'f5')
      );
    }

    function isNormalReloadEvent(e: { ctrlOrCmd: boolean; shiftKey: boolean; key: string }): boolean {
      const key = e.key.toLowerCase();
      if (isHardReloadEvent(e)) return false;
      return (e.ctrlOrCmd && key === 'r') || key === 'f5';
    }

    it('recognizes Ctrl+Shift+R as hard reload', () => {
      expect(isHardReloadEvent({ ctrlOrCmd: true, shiftKey: true, key: 'r' })).toBe(true);
      expect(isNormalReloadEvent({ ctrlOrCmd: true, shiftKey: true, key: 'r' })).toBe(false);
    });

    it('recognizes Ctrl+F5 as hard reload', () => {
      expect(isHardReloadEvent({ ctrlOrCmd: true, shiftKey: false, key: 'F5' })).toBe(true);
    });

    it('recognizes Shift+F5 as hard reload', () => {
      expect(isHardReloadEvent({ ctrlOrCmd: false, shiftKey: true, key: 'F5' })).toBe(true);
    });

    it('distinguishes standard Ctrl+R or F5 as normal reload', () => {
      expect(isHardReloadEvent({ ctrlOrCmd: true, shiftKey: false, key: 'r' })).toBe(false);
      expect(isNormalReloadEvent({ ctrlOrCmd: true, shiftKey: false, key: 'r' })).toBe(true);

      expect(isHardReloadEvent({ ctrlOrCmd: false, shiftKey: false, key: 'F5' })).toBe(false);
      expect(isNormalReloadEvent({ ctrlOrCmd: false, shiftKey: false, key: 'F5' })).toBe(true);
    });
  });

  describe('Chromium DevTools & Task Manager shortcut mappings', () => {
    function isDevToolsShortcut(e: { ctrlOrCmd: boolean; shiftKey: boolean; key: string }): boolean {
      const key = e.key.toLowerCase();
      return key === 'f12' || (e.ctrlOrCmd && e.shiftKey && key === 'i');
    }

    function isTaskManagerShortcut(e: { shiftKey: boolean; key: string }): boolean {
      const key = e.key.toLowerCase();
      return e.shiftKey && key === 'escape';
    }

    function isPrintShortcut(e: { ctrlOrCmd: boolean; shiftKey: boolean; key: string }): boolean {
      const key = e.key.toLowerCase();
      return e.ctrlOrCmd && !e.shiftKey && key === 'p';
    }

    it('activates DevTools on F12 and Ctrl+Shift+I', () => {
      expect(isDevToolsShortcut({ ctrlOrCmd: false, shiftKey: false, key: 'F12' })).toBe(true);
      expect(isDevToolsShortcut({ ctrlOrCmd: true, shiftKey: true, key: 'I' })).toBe(true);
      expect(isDevToolsShortcut({ ctrlOrCmd: true, shiftKey: false, key: 'i' })).toBe(false);
    });

    it('activates Task Manager on Shift+Esc', () => {
      expect(isTaskManagerShortcut({ shiftKey: true, key: 'Escape' })).toBe(true);
      expect(isTaskManagerShortcut({ shiftKey: false, key: 'Escape' })).toBe(false);
    });

    it('activates Print dialog on Ctrl+P, but not Ctrl+Shift+P', () => {
      expect(isPrintShortcut({ ctrlOrCmd: true, shiftKey: false, key: 'p' })).toBe(true);
      expect(isPrintShortcut({ ctrlOrCmd: true, shiftKey: true, key: 'p' })).toBe(false);
    });

    function isClickAndCleanShortcut(e: { ctrlOrCmd: boolean; shiftKey: boolean; key: string }): boolean {
      const key = e.key.toLowerCase();
      return e.ctrlOrCmd && e.shiftKey && (key === 'delete' || key === 'backspace');
    }

    it('activates Click & Clean on Ctrl+Shift+Delete or Cmd+Shift+Delete', () => {
      expect(isClickAndCleanShortcut({ ctrlOrCmd: true, shiftKey: true, key: 'Delete' })).toBe(true);
      expect(isClickAndCleanShortcut({ ctrlOrCmd: true, shiftKey: true, key: 'Backspace' })).toBe(true);
      expect(isClickAndCleanShortcut({ ctrlOrCmd: true, shiftKey: false, key: 'Delete' })).toBe(false);
      expect(isClickAndCleanShortcut({ ctrlOrCmd: false, shiftKey: true, key: 'Delete' })).toBe(false);
    });

    function isReaderModeShortcut(e: { ctrlOrCmd: boolean; altKey: boolean; key: string }): boolean {
      const key = e.key.toLowerCase();
      return (e.ctrlOrCmd && e.altKey && key === 'r') || key === 'f9';
    }

    it('activates Reader Mode on Ctrl+Alt+R, Cmd+Alt+R or F9', () => {
      expect(isReaderModeShortcut({ ctrlOrCmd: true, altKey: true, key: 'r' })).toBe(true);
      expect(isReaderModeShortcut({ ctrlOrCmd: false, altKey: false, key: 'F9' })).toBe(true);
      expect(isReaderModeShortcut({ ctrlOrCmd: true, altKey: false, key: 'r' })).toBe(false); // standard reload, not reader
    });

    function isScreenshotShortcut(e: { ctrlOrCmd: boolean; shiftKey: boolean; altKey?: boolean; key: string; code?: string }): boolean {
      const key = e.key.toLowerCase();
      const code = e.code || '';
      return Boolean(e.ctrlOrCmd && e.shiftKey && !e.altKey && (key === 's' || key === 'ы' || code === 'KeyS'));
    }

    it('activates Tab Screenshot on Ctrl+Shift+S, Cmd+Shift+S, and Cyrillic Ctrl+Shift+ы', () => {
      expect(isScreenshotShortcut({ ctrlOrCmd: true, shiftKey: true, key: 's' })).toBe(true);
      expect(isScreenshotShortcut({ ctrlOrCmd: true, shiftKey: true, key: 'S' })).toBe(true);
      expect(isScreenshotShortcut({ ctrlOrCmd: true, shiftKey: true, key: 'ы' })).toBe(true);
      expect(isScreenshotShortcut({ ctrlOrCmd: true, shiftKey: true, key: 'Ы' })).toBe(true);
      expect(isScreenshotShortcut({ ctrlOrCmd: true, shiftKey: true, key: '', code: 'KeyS' })).toBe(true);
      expect(isScreenshotShortcut({ ctrlOrCmd: true, shiftKey: false, key: 's' })).toBe(false);
      expect(isScreenshotShortcut({ ctrlOrCmd: false, shiftKey: true, key: 's' })).toBe(false);
      expect(isScreenshotShortcut({ ctrlOrCmd: true, shiftKey: true, altKey: true, key: 's' })).toBe(false);
    });
  });
});

describe('Omnibox keyboard navigation and live preview state machine', () => {
  interface OmniboxNavState {
    selectedIndex: number;
    currentAddress: string;
    originalAddress: string;
    isEditing: boolean;
  }

  function handleOmniboxKey(
    key: 'ArrowDown' | 'ArrowUp' | 'Escape' | 'Enter',
    state: OmniboxNavState,
    suggestions: OmniboxSuggestion[]
  ): { nextState: OmniboxNavState; targetToNavigate?: string } {
    const count = suggestions.length;
    if (count === 0) {
      if (key === 'Escape') {
        return {
          nextState: {
            ...state,
            currentAddress: state.originalAddress,
            selectedIndex: -1,
            isEditing: false,
          },
        };
      }
      if (key === 'Enter') {
        return {
          nextState: { ...state, isEditing: false, selectedIndex: -1 },
          targetToNavigate: state.currentAddress,
        };
      }
      return { nextState: state };
    }

    if (key === 'ArrowDown') {
      const next = state.selectedIndex < count - 1 ? state.selectedIndex + 1 : -1;
      const preview =
        next === -1
          ? state.originalAddress
          : suggestions[next].kind === 'search'
            ? state.originalAddress
            : suggestions[next].url;
      return {
        nextState: {
          ...state,
          selectedIndex: next,
          currentAddress: preview,
        },
      };
    }

    if (key === 'ArrowUp') {
      const next = state.selectedIndex <= -1 ? count - 1 : state.selectedIndex - 1;
      const preview =
        next === -1
          ? state.originalAddress
          : suggestions[next].kind === 'search'
            ? state.originalAddress
            : suggestions[next].url;
      return {
        nextState: {
          ...state,
          selectedIndex: next,
          currentAddress: preview,
        },
      };
    }

    if (key === 'Escape') {
      if (state.selectedIndex !== -1) {
        return {
          nextState: {
            ...state,
            currentAddress: state.originalAddress,
            selectedIndex: -1,
            isEditing: true,
          },
        };
      }
      return {
        nextState: {
          ...state,
          currentAddress: state.originalAddress,
          selectedIndex: -1,
          isEditing: false,
        },
      };
    }

    if (key === 'Enter') {
      const target =
        state.selectedIndex >= 0 && state.selectedIndex < count
          ? suggestions[state.selectedIndex].url
          : state.currentAddress;
      return {
        nextState: {
          ...state,
          selectedIndex: -1,
          isEditing: false,
        },
        targetToNavigate: target,
      };
    }

    return { nextState: state };
  }

  const mockSuggestions: OmniboxSuggestion[] = [
    {
      id: 'sug-1',
      title: 'GitHub',
      domain: 'github.com',
      url: 'https://github.com',
      kind: 'popular',
    },
    {
      id: 'sug-2',
      title: 'GitLab',
      domain: 'gitlab.com',
      url: 'https://gitlab.com',
      kind: 'popular',
    },
    {
      id: 'sug-3',
      title: 'Поиск git в Яндексе',
      url: 'https://yandex.ru/search/?text=git',
      kind: 'search',
    },
  ];

  it('cycles through suggestions down and previews URL or keeps search input', () => {
    let state: OmniboxNavState = {
      selectedIndex: -1,
      currentAddress: 'git',
      originalAddress: 'git',
      isEditing: true,
    };

    // 1st ArrowDown -> item 0 (GitHub URL)
    let res = handleOmniboxKey('ArrowDown', state, mockSuggestions);
    expect(res.nextState.selectedIndex).toBe(0);
    expect(res.nextState.currentAddress).toBe('https://github.com');
    state = res.nextState;

    // 2nd ArrowDown -> item 1 (GitLab URL)
    res = handleOmniboxKey('ArrowDown', state, mockSuggestions);
    expect(res.nextState.selectedIndex).toBe(1);
    expect(res.nextState.currentAddress).toBe('https://gitlab.com');
    state = res.nextState;

    // 3rd ArrowDown -> item 2 (Search kind -> shows original address preview)
    res = handleOmniboxKey('ArrowDown', state, mockSuggestions);
    expect(res.nextState.selectedIndex).toBe(2);
    expect(res.nextState.currentAddress).toBe('git');
    state = res.nextState;

    // 4th ArrowDown -> wraps back to -1 and restores original typed input
    res = handleOmniboxKey('ArrowDown', state, mockSuggestions);
    expect(res.nextState.selectedIndex).toBe(-1);
    expect(res.nextState.currentAddress).toBe('git');
  });

  it('cycles backwards with ArrowUp and wraps to last item', () => {
    const state: OmniboxNavState = {
      selectedIndex: -1,
      currentAddress: 'git',
      originalAddress: 'git',
      isEditing: true,
    };

    // ArrowUp from -1 -> jumps to last item (index 2)
    const res = handleOmniboxKey('ArrowUp', state, mockSuggestions);
    expect(res.nextState.selectedIndex).toBe(2);
    expect(res.nextState.currentAddress).toBe('git');

    // ArrowUp from 2 -> jumps to item 1 (https://gitlab.com)
    const res2 = handleOmniboxKey('ArrowUp', res.nextState, mockSuggestions);
    expect(res2.nextState.selectedIndex).toBe(1);
    expect(res2.nextState.currentAddress).toBe('https://gitlab.com');
  });

  it('restores original address on 1st Escape, and closes on 2nd Escape', () => {
    const state: OmniboxNavState = {
      selectedIndex: 0,
      currentAddress: 'https://github.com',
      originalAddress: 'git',
      isEditing: true,
    };

    // 1st Escape reverts preview back to typed input 'git' while keeping editing open
    const res1 = handleOmniboxKey('Escape', state, mockSuggestions);
    expect(res1.nextState.selectedIndex).toBe(-1);
    expect(res1.nextState.currentAddress).toBe('git');
    expect(res1.nextState.isEditing).toBe(true);

    // 2nd Escape cancels editing
    const res2 = handleOmniboxKey('Escape', res1.nextState, mockSuggestions);
    expect(res2.nextState.selectedIndex).toBe(-1);
    expect(res2.nextState.currentAddress).toBe('git');
    expect(res2.nextState.isEditing).toBe(false);
  });

  it('navigates to selected suggestion on Enter', () => {
    const state: OmniboxNavState = {
      selectedIndex: 1, // GitLab
      currentAddress: 'https://gitlab.com',
      originalAddress: 'git',
      isEditing: true,
    };

    const res = handleOmniboxKey('Enter', state, mockSuggestions);
    expect(res.targetToNavigate).toBe('https://gitlab.com');
    expect(res.nextState.selectedIndex).toBe(-1);
    expect(res.nextState.isEditing).toBe(false);
  });

  it('navigates to typed address when Enter is pressed without selection', () => {
    const state: OmniboxNavState = {
      selectedIndex: -1,
      currentAddress: 'https://mysite.org',
      originalAddress: 'https://mysite.org',
      isEditing: true,
    };

    const res = handleOmniboxKey('Enter', state, mockSuggestions);
    expect(res.targetToNavigate).toBe('https://mysite.org');
  });

  describe('Tab drag and reordering logic', () => {
    function reorderTabs(
      tabIds: string[],
      sourceId: string,
      targetId: string,
      position: 'before' | 'after' = 'before',
    ): string[] {
      const list = [...tabIds];
      const sourceIndex = list.indexOf(sourceId);
      if (sourceIndex === -1) return list;

      if (targetId === 'end') {
        const [removed] = list.splice(sourceIndex, 1);
        list.push(removed);
        return list;
      }

      const targetIndex = list.indexOf(targetId);
      if (targetIndex === -1 || sourceIndex === targetIndex) return list;

      const [removed] = list.splice(sourceIndex, 1);
      let insertIndex = list.indexOf(targetId);
      if (position === 'after') {
        insertIndex += 1;
      }
      list.splice(insertIndex, 0, removed);
      return list;
    }

    it('reorders tab before target tab', () => {
      const tabs = ['tab-1', 'tab-2', 'tab-3', 'tab-4'];
      const result = reorderTabs(tabs, 'tab-4', 'tab-2', 'before');
      expect(result).toEqual(['tab-1', 'tab-4', 'tab-2', 'tab-3']);
    });

    it('reorders tab after target tab', () => {
      const tabs = ['tab-1', 'tab-2', 'tab-3', 'tab-4'];
      const result = reorderTabs(tabs, 'tab-1', 'tab-3', 'after');
      expect(result).toEqual(['tab-2', 'tab-3', 'tab-1', 'tab-4']);
    });

    it('moves tab to the end when dropping on strip container', () => {
      const tabs = ['tab-1', 'tab-2', 'tab-3', 'tab-4'];
      const result = reorderTabs(tabs, 'tab-2', 'end');
      expect(result).toEqual(['tab-1', 'tab-3', 'tab-4', 'tab-2']);
    });

    it('calculates correct drop side based on cursor horizontal position', () => {
      function getDropSide(cursorX: number, tabLeft: number, tabWidth: number): 'left' | 'right' {
        return cursorX < tabLeft + tabWidth / 2 ? 'left' : 'right';
      }

      expect(getDropSide(120, 100, 100)).toBe('left'); // 120 < 150
      expect(getDropSide(170, 100, 100)).toBe('right'); // 170 >= 150
    });
  });

  describe('Address Focus & Shortcut Variations (Alt+D, Alt+В, F6, Ctrl+L)', () => {
    function isOmniboxFocusShortcut(e: { ctrlOrCmd: boolean; altKey: boolean; shiftKey: boolean; key: string }): boolean {
      const key = e.key.toLowerCase();
      return (
        (e.ctrlOrCmd && key === 'l') ||
        key === 'f6' ||
        (e.altKey && !e.ctrlOrCmd && !e.shiftKey && (key === 'd' || key === 'в'))
      );
    }

    it('identifies Ctrl+L as omnibox focus', () => {
      expect(isOmniboxFocusShortcut({ ctrlOrCmd: true, altKey: false, shiftKey: false, key: 'l' })).toBe(true);
    });

    it('identifies F6 as omnibox focus', () => {
      expect(isOmniboxFocusShortcut({ ctrlOrCmd: false, altKey: false, shiftKey: false, key: 'F6' })).toBe(true);
    });

    it('identifies Alt+D and Cyrillic Alt+В as omnibox focus', () => {
      expect(isOmniboxFocusShortcut({ ctrlOrCmd: false, altKey: true, shiftKey: false, key: 'd' })).toBe(true);
      expect(isOmniboxFocusShortcut({ ctrlOrCmd: false, altKey: true, shiftKey: false, key: 'в' })).toBe(true);
      expect(isOmniboxFocusShortcut({ ctrlOrCmd: true, altKey: true, shiftKey: false, key: 'd' })).toBe(false);
    });
  });

  describe('Middle Click (auxclick button === 1) tab closing logic', () => {
    it('recognizes middle mouse click for closing tab and ignores left/right click', () => {
      function shouldCloseOnAux(button: number): boolean {
        return button === 1;
      }
      expect(shouldCloseOnAux(1)).toBe(true); // middle click
      expect(shouldCloseOnAux(0)).toBe(false); // left click
      expect(shouldCloseOnAux(2)).toBe(false); // right click
    });
  });
});

describe('Chromium Address Bar Focus shortcuts (Alt+D, F6, Ctrl+L)', () => {
  function isAddressBarFocusEvent(e: {
    ctrlOrCmd: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    key: string;
  }): boolean {
    const key = e.key.toLowerCase();
    const isCtrlL = e.ctrlOrCmd && !e.altKey && !e.shiftKey && key === 'l';
    const isF6 = !e.ctrlOrCmd && !e.altKey && !e.shiftKey && key === 'f6';
    const isAltD = !e.ctrlOrCmd && Boolean(e.altKey) && !e.shiftKey && key === 'd';
    return isCtrlL || isF6 || isAltD;
  }

  it('triggers address bar focus on Ctrl+L or Cmd+L', () => {
    expect(isAddressBarFocusEvent({ ctrlOrCmd: true, key: 'l' })).toBe(true);
    expect(isAddressBarFocusEvent({ ctrlOrCmd: true, key: 'L' })).toBe(true);
  });

  it('triggers address bar focus on F6', () => {
    expect(isAddressBarFocusEvent({ ctrlOrCmd: false, key: 'F6' })).toBe(true);
    expect(isAddressBarFocusEvent({ ctrlOrCmd: false, key: 'f6' })).toBe(true);
  });

  it('triggers address bar focus on Alt+D', () => {
    expect(isAddressBarFocusEvent({ ctrlOrCmd: false, altKey: true, key: 'd' })).toBe(true);
    expect(isAddressBarFocusEvent({ ctrlOrCmd: false, altKey: true, key: 'D' })).toBe(true);
  });

  it('distinguishes Ctrl+D (bookmark) from Alt+D (address focus)', () => {
    // Ctrl+D is bookmark shortcut, should NOT trigger address bar focus
    expect(isAddressBarFocusEvent({ ctrlOrCmd: true, altKey: false, key: 'd' })).toBe(false);
  });

  it('rejects ambiguous modifier combinations like Ctrl+Alt+D or Shift+F6', () => {
    expect(isAddressBarFocusEvent({ ctrlOrCmd: true, altKey: true, key: 'd' })).toBe(false);
    expect(isAddressBarFocusEvent({ ctrlOrCmd: false, altKey: true, shiftKey: true, key: 'd' })).toBe(false);
    expect(isAddressBarFocusEvent({ ctrlOrCmd: false, shiftKey: true, key: 'F6' })).toBe(false);
    expect(isAddressBarFocusEvent({ ctrlOrCmd: true, shiftKey: true, key: 'l' })).toBe(false);
  });
});

describe('Chromium Tab Navigation logic (Ctrl+1..9, middle-click close, audio mute/unmute)', () => {
  interface TabEntry {
    id: string;
    title: string;
    isPinned?: boolean;
    isPrivate?: boolean;
    workspaceId?: string;
    isAudible?: boolean;
    isMuted?: boolean;
  }

  function getTargetTabByNumberShortcut(
    tabs: TabEntry[],
    key: string,
    currentTabWorkspace = 'personal',
    isPrivate = false
  ): TabEntry | undefined {
    if (!/^[1-9]$/.test(key)) return undefined;
    const visible = tabs
      .filter((entry) => (entry.workspaceId ?? 'personal') === currentTabWorkspace && Boolean(entry.isPrivate) === isPrivate)
      .sort((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)));
    if (visible.length === 0) return undefined;
    const index = key === '9' ? visible.length - 1 : Number(key) - 1;
    return visible[index];
  }

  it('selects tab 1 through 8 by index position (1-based)', () => {
    const tabs: TabEntry[] = [
      { id: 'tab-1', title: 'Tab 1' },
      { id: 'tab-2', title: 'Tab 2' },
      { id: 'tab-3', title: 'Tab 3' },
      { id: 'tab-4', title: 'Tab 4' },
    ];
    expect(getTargetTabByNumberShortcut(tabs, '1')?.id).toBe('tab-1');
    expect(getTargetTabByNumberShortcut(tabs, '2')?.id).toBe('tab-2');
    expect(getTargetTabByNumberShortcut(tabs, '3')?.id).toBe('tab-3');
    expect(getTargetTabByNumberShortcut(tabs, '4')?.id).toBe('tab-4');
  });

  it('always selects the last tab on Ctrl+9 regardless of total tab count', () => {
    // Chromium specification: Ctrl+9 jumps to the last visible tab
    const tabsShort: TabEntry[] = [
      { id: 'tab-a', title: 'A' },
      { id: 'tab-b', title: 'B' },
      { id: 'tab-c', title: 'C' },
    ];
    expect(getTargetTabByNumberShortcut(tabsShort, '9')?.id).toBe('tab-c');

    const tabsMany: TabEntry[] = Array.from({ length: 15 }, (_, i) => ({
      id: `tab-${i + 1}`,
      title: `Tab ${i + 1}`,
    }));
    expect(getTargetTabByNumberShortcut(tabsMany, '9')?.id).toBe('tab-15');
  });

  it('returns undefined when number shortcut exceeds tab count (except 9)', () => {
    const tabs: TabEntry[] = [
      { id: 'tab-1', title: 'Tab 1' },
      { id: 'tab-2', title: 'Tab 2' },
    ];
    expect(getTargetTabByNumberShortcut(tabs, '5')).toBeUndefined();
    expect(getTargetTabByNumberShortcut(tabs, '8')).toBeUndefined();
  });

  it('places pinned tabs first in the navigation order', () => {
    const tabs: TabEntry[] = [
      { id: 'tab-1', title: 'Tab 1', isPinned: false },
      { id: 'tab-2', title: 'Tab 2', isPinned: true },
      { id: 'tab-3', title: 'Tab 3', isPinned: false },
    ];
    // Pinned tab-2 moves to index 0
    expect(getTargetTabByNumberShortcut(tabs, '1')?.id).toBe('tab-2');
    expect(getTargetTabByNumberShortcut(tabs, '2')?.id).toBe('tab-1');
    expect(getTargetTabByNumberShortcut(tabs, '3')?.id).toBe('tab-3');
  });

  it('isolates private tabs from normal tabs during shortcut navigation', () => {
    const tabs: TabEntry[] = [
      { id: 'norm-1', title: 'Normal 1', isPrivate: false },
      { id: 'norm-2', title: 'Normal 2', isPrivate: false },
      { id: 'priv-1', title: 'Private 1', isPrivate: true },
    ];
    // In normal session:
    expect(getTargetTabByNumberShortcut(tabs, '1', 'personal', false)?.id).toBe('norm-1');
    expect(getTargetTabByNumberShortcut(tabs, '2', 'personal', false)?.id).toBe('norm-2');
    expect(getTargetTabByNumberShortcut(tabs, '3', 'personal', false)).toBeUndefined();

    // In private session:
    expect(getTargetTabByNumberShortcut(tabs, '1', 'personal', true)?.id).toBe('priv-1');
  });

  describe('Tab middle-click closing behavior', () => {
    function handleTabClick(
      event: { button: number; preventDefault: () => void },
      tabId: string,
      callbacks: { onActivate: (id: string) => void; onClose: (id: string) => void }
    ): 'activated' | 'closed' | 'none' {
      if (event.button === 0) {
        callbacks.onActivate(tabId);
        return 'activated';
      }
      if (event.button === 1) {
        event.preventDefault();
        callbacks.onClose(tabId);
        return 'closed';
      }
      return 'none';
    }

    it('closes tab on middle-click (mouse button 1) and prevents default', () => {
      let closedId = '';
      let activatedId = '';
      let prevented = false;
      const event = { button: 1, preventDefault: () => { prevented = true; } };

      const result = handleTabClick(event, 'tab-test', {
        onActivate: (id) => { activatedId = id; },
        onClose: (id) => { closedId = id; },
      });

      expect(result).toBe('closed');
      expect(closedId).toBe('tab-test');
      expect(activatedId).toBe('');
      expect(prevented).toBe(true);
    });

    it('activates tab on primary left-click (mouse button 0)', () => {
      let closedId = '';
      let activatedId = '';
      const event = { button: 0, preventDefault: () => {} };

      const result = handleTabClick(event, 'tab-test', {
        onActivate: (id) => { activatedId = id; },
        onClose: (id) => { closedId = id; },
      });

      expect(result).toBe('activated');
      expect(activatedId).toBe('tab-test');
      expect(closedId).toBe('');
    });

    it('ignores right-click (mouse button 2) in auxclick handler', () => {
      let closedId = '';
      const event = { button: 2, preventDefault: () => {} };

      const result = handleTabClick(event, 'tab-test', {
        onActivate: () => {},
        onClose: (id) => { closedId = id; },
      });

      expect(result).toBe('none');
      expect(closedId).toBe('');
    });
  });

  describe('Tab audio mute / unmute action state machine', () => {
    function toggleTabAudioMute(tab: { isAudible?: boolean; isMuted?: boolean }): { isMuted: boolean } {
      return { isMuted: !tab.isMuted };
    }

    it('toggles muted state from false to true and true to false', () => {
      const tab = { isAudible: true, isMuted: false };
      const next1 = toggleTabAudioMute(tab);
      expect(next1.isMuted).toBe(true);

      const next2 = toggleTabAudioMute({ ...tab, ...next1 });
      expect(next2.isMuted).toBe(false);
    });

    it('determines visibility of audio toggle button based on isAudible or isMuted', () => {
      function shouldShowAudioButton(tab: { isAudible?: boolean; isMuted?: boolean }): boolean {
        return Boolean(tab.isAudible || tab.isMuted);
      }

      expect(shouldShowAudioButton({ isAudible: true, isMuted: false })).toBe(true);
      expect(shouldShowAudioButton({ isAudible: true, isMuted: true })).toBe(true);
      expect(shouldShowAudioButton({ isAudible: false, isMuted: true })).toBe(true);
      expect(shouldShowAudioButton({ isAudible: false, isMuted: false })).toBe(false);
    });
  });
});
