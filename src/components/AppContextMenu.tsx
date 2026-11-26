import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { AppPage } from '../utils/router';
import {
  PixelCalendarIcon,
  PixelCheckIcon,
  PixelCloseIcon,
  PixelCopyIcon,
  PixelEyeIcon,
  PixelGamepadIcon,
  PixelHelpIcon,
  PixelIdeaIcon,
  PixelLinkIcon,
  PixelLockIcon,
  PixelLoungeIcon,
  PixelRefreshIcon,
  PixelSettingsIcon,
  PixelTerminalIcon,
  PixelToolsIcon,
  PixelUserIcon,
} from './PixelIcons';

export type ContextMenuItem =
  | {
      type: 'action';
      id: string;
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      active?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | {
      type: 'separator';
      id: string;
    }
  | {
      type: 'label';
      id: string;
      label: string;
    };

export interface ContextMenuOpenOptions {
  header?: string;
  targetEl?: HTMLElement | null;
}

interface ActiveContextMenuState {
  x: number;
  y: number;
  header?: string;
  items: ContextMenuItem[];
  targetEl: HTMLElement | null;
}

interface InspectedElementSnapshot {
  tag: string;
  id?: string;
  classes: string[];
  selector: string;
  rect: { left: number; top: number; width: number; height: number };
  role?: string;
  ariaLabel?: string;
  textPreview?: string;
  href?: string;
}

interface ContextMenuContextValue {
  openContextMenu: (
    event: ReactMouseEvent | MouseEvent,
    items: ContextMenuItem[],
    options?: ContextMenuOpenOptions,
  ) => void;
  closeContextMenu: () => void;
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);

export function useContextMenu(): ContextMenuContextValue {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) {
    return {
      openContextMenu: () => undefined,
      closeContextMenu: () => undefined,
    };
  }
  return ctx;
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

function buildCssSelector(el: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = el;
  let depth = 0;

  while (current && current !== document.body && depth < 5) {
    let segment = current.tagName.toLowerCase();
    if (current.id) {
      segment += `#${current.id}`;
      parts.unshift(segment);
      break;
    }
    const classList = Array.from(current.classList)
      .filter((cls) => cls.length > 0 && !cls.startsWith('is-'))
      .slice(0, 2);
    if (classList.length > 0) {
      segment += `.${classList.join('.')}`;
    }
    parts.unshift(segment);
    current = current.parentElement;
    depth += 1;
  }

  return parts.join(' > ') || el.tagName.toLowerCase();
}

function captureElementSnapshot(el: HTMLElement): InspectedElementSnapshot {
  const rect = el.getBoundingClientRect();
  const rawText = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const anchor = el.closest('a[href]') as HTMLAnchorElement | null;

  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    classes: Array.from(el.classList).slice(0, 8),
    selector: buildCssSelector(el),
    rect: {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    role: el.getAttribute('role') || undefined,
    ariaLabel: el.getAttribute('aria-label') || undefined,
    textPreview: rawText ? (rawText.length > 90 ? `${rawText.slice(0, 90)}…` : rawText) : undefined,
    href: anchor?.href || undefined,
  };
}

function resolveEventElement(target: EventTarget | null): Element | null {
  if (!target) return null;
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function resolveHtmlElement(target: EventTarget | null): HTMLElement | null {
  let current = resolveEventElement(target);
  while (current) {
    if (current instanceof HTMLElement) return current;
    current = current.parentElement;
  }
  return null;
}

function isEditableElement(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const input = el as HTMLInputElement;
    const editableTypes = new Set([
      'text',
      'search',
      'email',
      'url',
      'tel',
      'password',
      'number',
    ]);
    return editableTypes.has((input.type || 'text').toLowerCase());
  }
  return false;
}

export interface ContextMenuDeferOptions {
  /** Optional CSS selector for nested sub-regions that should not inherit this container's menu. */
  excludeSelector?: string;
}

/**
 * Returns true when a right-click inside a contextual element landed on a
 * higher-specificity target (editable field, hyperlink, or excluded sub-region)
 * so the event bubbles to the appropriate global/native context menu instead.
 */
export function shouldDeferContextMenu(
  event: ReactMouseEvent | MouseEvent,
  options?: ContextMenuDeferOptions,
): boolean {
  const el = resolveEventElement(event.target);
  if (!el) return false;

  const editableEl = el.closest('input, textarea');
  if (isEditableElement(editableEl)) return true;

  if (el.closest('[contenteditable="true"], [contenteditable=""]')) return true;

  const anchorEl = el.closest('a[href]') as HTMLAnchorElement | null;
  if (anchorEl && anchorEl.href) return true;

  if (options?.excludeSelector && el.closest(options.excludeSelector)) return true;

  return false;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to execCommand below.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export interface ContextMenuProviderProps {
  activePage: AppPage;
  isCloudConnected: boolean;
  onNavigate: (page: AppPage) => void;
  onOpenSettings: () => void;
  onOpenSignIn: () => void;
  onStartTutorial: () => void;
  onNotify?: (options: {
    tone: 'success' | 'info' | 'warning' | 'error';
    tag: string;
    message: string;
  }) => void;
  children: ReactNode;
}

const VIEWPORT_PADDING = 10;

/**
 * Site-wide sleek Discord/YouTube-inspired custom right-click context menu system.
 * Adapts dynamically to chat messages, announcements, ideas, sessions, links, inputs,
 * text selections, and empty canvas space while preserving Inspect & native menu access.
 */
export function ContextMenuProvider({
  activePage,
  isCloudConnected,
  onNavigate,
  onOpenSettings,
  onOpenSignIn,
  onStartTutorial,
  onNotify,
  children,
}: ContextMenuProviderProps) {
  const [menuState, setMenuState] = useState<ActiveContextMenuState | null>(null);
  const [positionedCoords, setPositionedCoords] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });
  const [focusedActionIndex, setFocusedActionIndex] = useState<number>(-1);
  const [inspectedElement, setInspectedElement] = useState<InspectedElementSnapshot | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  const nativePassThroughRef = useRef(false);

  const devToolsShortcut = useMemo(() => (isMacPlatform() ? '⌥⌘I' : 'F12'), []);

  const closeContextMenu = useCallback(() => {
    setMenuState(null);
    setFocusedActionIndex(-1);
  }, []);

  const notifyCopy = useCallback(
    async (text: string, label: string) => {
      const ok = await copyTextToClipboard(text);
      onNotify?.({
        tone: ok ? 'success' : 'error',
        tag: ok ? 'Copied' : 'Clipboard',
        message: ok ? `Copied ${label} to clipboard.` : `Unable to copy ${label}.`,
      });
    },
    [onNotify],
  );

  const appendDeveloperFooter = useCallback(
    (baseItems: ContextMenuItem[], targetEl: HTMLElement | null): ContextMenuItem[] => {
      const items = [...baseItems];
      if (items.length > 0 && items[items.length - 1]?.type !== 'separator') {
        items.push({ type: 'separator', id: 'dev-sep' });
      }
      items.push({
        type: 'action',
        id: 'dev-inspect',
        label: 'Inspect Element',
        icon: <PixelTerminalIcon width={13} height={13} />,
        shortcut: devToolsShortcut,
        onSelect: () => {
          const el = targetEl || document.body;
          setInspectedElement(captureElementSnapshot(el));
        },
      });
      items.push({
        type: 'action',
        id: 'dev-native-menu',
        label: 'Native Browser Menu',
        icon: <PixelEyeIcon width={13} height={13} />,
        shortcut: '⇧ Right-Click',
        onSelect: () => {
          nativePassThroughRef.current = true;
          onNotify?.({
            tone: 'info',
            tag: 'Native Menu Ready',
            message:
              'Right-click once anywhere (or hold Shift + Right-Click anytime) for the browser menu & native Inspect.',
          });
        },
      });
      return items;
    },
    [devToolsShortcut, onNotify],
  );

  const openContextMenu = useCallback(
    (
      event: ReactMouseEvent | MouseEvent,
      items: ContextMenuItem[],
      options?: ContextMenuOpenOptions,
    ) => {
      // Shift + Right-Click or one-shot pass-through opens the browser's native menu cleanly.
      if (event.shiftKey || nativePassThroughRef.current) {
        nativePassThroughRef.current = false;
        setMenuState(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const targetEl = options?.targetEl ?? resolveHtmlElement(event.target);
      const enrichedItems = appendDeveloperFooter(items, targetEl);

      setInspectedElement(null);
      setFocusedActionIndex(-1);
      setPositionedCoords({ left: event.clientX, top: event.clientY });
      setMenuState({
        x: event.clientX,
        y: event.clientY,
        header: options?.header,
        items: enrichedItems,
        targetEl,
      });
    },
    [appendDeveloperFooter],
  );

  // Build smart global fallback menus for inputs, links, selected text, and empty space.
  useEffect(() => {
    function handleGlobalContextMenu(event: MouseEvent) {
      if (event.defaultPrevented) return;
      if (event.shiftKey || nativePassThroughRef.current) {
        nativePassThroughRef.current = false;
        setMenuState(null);
        return;
      }

      const rawElement = resolveEventElement(event.target);
      const rawTarget = resolveHtmlElement(event.target);
      // Don't hijack right-click inside our own context menu or inspector popover.
      if (rawElement?.closest('.app-context-menu, .app-element-inspector')) {
        event.preventDefault();
        return;
      }

      event.preventDefault();

      const items: ContextMenuItem[] = [];
      let header = 'Team SPIRIT';

      const selectedText = window.getSelection?.()?.toString().trim() ?? '';
      const editableEl = rawElement?.closest('input, textarea') ?? null;
      const anchorEl = (rawElement?.closest('a[href]') as HTMLAnchorElement | null) ?? null;

      if (isEditableElement(editableEl)) {
        header = 'Text Input';
        const inputEl = editableEl;
        const start = inputEl.selectionStart ?? 0;
        const end = inputEl.selectionEnd ?? 0;
        const hasSelection = end > start;
        const selectedSlice = hasSelection ? inputEl.value.slice(start, end) : '';

        items.push(
          {
            type: 'action',
            id: 'input-cut',
            label: 'Cut',
            icon: <PixelCopyIcon width={13} height={13} />,
            shortcut: isMacPlatform() ? '⌘X' : 'Ctrl+X',
            disabled: !hasSelection || inputEl.readOnly || inputEl.disabled,
            onSelect: () => {
              if (!hasSelection) return;
              void copyTextToClipboard(selectedSlice);
              inputEl.focus();
              const nextVal = inputEl.value.slice(0, start) + inputEl.value.slice(end);
              const proto =
                inputEl.tagName === 'TEXTAREA'
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              setter?.call(inputEl, nextVal);
              inputEl.dispatchEvent(new Event('input', { bubbles: true }));
              inputEl.setSelectionRange(start, start);
            },
          },
          {
            type: 'action',
            id: 'input-copy',
            label: 'Copy',
            icon: <PixelCopyIcon width={13} height={13} />,
            shortcut: isMacPlatform() ? '⌘C' : 'Ctrl+C',
            disabled: !hasSelection,
            onSelect: () => {
              void notifyCopy(selectedSlice, 'selected text');
            },
          },
          {
            type: 'action',
            id: 'input-paste',
            label: 'Paste',
            icon: <PixelCopyIcon width={13} height={13} />,
            shortcut: isMacPlatform() ? '⌘V' : 'Ctrl+V',
            disabled: inputEl.readOnly || inputEl.disabled,
            onSelect: () => {
              void (async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (!text) return;
                  inputEl.focus();
                  const curStart = inputEl.selectionStart ?? inputEl.value.length;
                  const curEnd = inputEl.selectionEnd ?? inputEl.value.length;
                  const nextVal =
                    inputEl.value.slice(0, curStart) + text + inputEl.value.slice(curEnd);
                  const proto =
                    inputEl.tagName === 'TEXTAREA'
                      ? HTMLTextAreaElement.prototype
                      : HTMLInputElement.prototype;
                  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                  setter?.call(inputEl, nextVal);
                  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                  const cursor = curStart + text.length;
                  inputEl.setSelectionRange(cursor, cursor);
                } catch {
                  onNotify?.({
                    tone: 'info',
                    tag: 'Paste',
                    message: `Use ${isMacPlatform() ? '⌘V' : 'Ctrl+V'} to paste into this field.`,
                  });
                }
              })();
            },
          },
          {
            type: 'action',
            id: 'input-select-all',
            label: 'Select All',
            shortcut: isMacPlatform() ? '⌘A' : 'Ctrl+A',
            disabled: inputEl.value.length === 0,
            onSelect: () => {
              inputEl.focus();
              inputEl.select();
            },
          },
        );
      } else if (anchorEl && anchorEl.href) {
        header = 'Link';
        const href = anchorEl.href;
        items.push(
          {
            type: 'action',
            id: 'link-open',
            label: 'Open Link',
            icon: <PixelLinkIcon width={13} height={13} />,
            onSelect: () => {
              anchorEl.click();
            },
          },
          {
            type: 'action',
            id: 'link-open-tab',
            label: 'Open in New Tab',
            icon: <PixelLinkIcon width={13} height={13} />,
            onSelect: () => {
              window.open(href, '_blank', 'noopener,noreferrer');
            },
          },
          {
            type: 'action',
            id: 'link-copy',
            label: 'Copy Link Address',
            icon: <PixelCopyIcon width={13} height={13} />,
            onSelect: () => {
              void notifyCopy(href, 'link address');
            },
          },
        );
        if (selectedText) {
          items.push({
            type: 'action',
            id: 'selection-copy-link',
            label: 'Copy Selected Text',
            icon: <PixelCopyIcon width={13} height={13} />,
            onSelect: () => {
              void notifyCopy(selectedText, 'selected text');
            },
          });
        }
      } else {
        if (selectedText) {
          header = 'Selection';
          items.push(
            {
              type: 'action',
              id: 'selection-copy',
              label: `Copy "${selectedText.length > 26 ? `${selectedText.slice(0, 26)}…` : selectedText}"`,
              icon: <PixelCopyIcon width={13} height={13} />,
              shortcut: isMacPlatform() ? '⌘C' : 'Ctrl+C',
              onSelect: () => {
                void notifyCopy(selectedText, 'selected text');
              },
            },
            { type: 'separator', id: 'selection-sep' },
          );
        }

        items.push(
          { type: 'label', id: 'nav-label', label: 'Navigate' },
          {
            type: 'action',
            id: 'nav-lounge',
            label: 'Student Lounge',
            icon: <PixelLoungeIcon width={13} height={13} />,
            active: activePage === 'lounge',
            onSelect: () => onNavigate('lounge'),
          },
          {
            type: 'action',
            id: 'nav-games',
            label: 'Arcade Games',
            icon: <PixelGamepadIcon width={13} height={13} />,
            active: activePage === 'games',
            onSelect: () => onNavigate('games'),
          },
          {
            type: 'action',
            id: 'nav-ideas',
            label: 'Project Ideas',
            icon: <PixelIdeaIcon width={13} height={13} />,
            active: activePage === 'ideas',
            onSelect: () => onNavigate('ideas'),
          },
          {
            type: 'action',
            id: 'nav-attendance',
            label: 'Attendance Tools',
            icon: <PixelToolsIcon width={13} height={13} />,
            active: activePage === 'tracker',
            onSelect: () => onNavigate('tracker'),
          },
          {
            type: 'action',
            id: 'nav-calendar',
            label: 'Session Calendar',
            icon: <PixelCalendarIcon width={13} height={13} />,
            active: activePage === 'calendar',
            onSelect: () => onNavigate('calendar'),
          },
          { type: 'separator', id: 'util-sep' },
          {
            type: 'action',
            id: 'util-copy-url',
            label: 'Copy Page Link',
            icon: <PixelLinkIcon width={13} height={13} />,
            onSelect: () => {
              void notifyCopy(window.location.href, 'page link');
            },
          },
          {
            type: 'action',
            id: 'util-refresh',
            label: 'Refresh Page',
            icon: <PixelRefreshIcon width={13} height={13} />,
            onSelect: () => {
              window.location.reload();
            },
          },
          {
            type: 'action',
            id: 'util-settings',
            label: isCloudConnected ? 'Account & Settings' : 'Workspace Settings',
            icon: <PixelSettingsIcon width={13} height={13} />,
            onSelect: () => {
              if (activePage === 'landing') {
                onNavigate('lounge');
              }
              onOpenSettings();
            },
          },
        );

        if (!isCloudConnected) {
          items.push({
            type: 'action',
            id: 'util-signin',
            label: 'Sign In to Club Account',
            icon: <PixelLockIcon width={13} height={13} />,
            onSelect: onOpenSignIn,
          });
        }

        if (activePage !== 'landing') {
          items.push({
            type: 'action',
            id: 'util-tour',
            label: 'Interactive Walkthrough',
            icon: <PixelHelpIcon width={13} height={13} />,
            onSelect: onStartTutorial,
          });
        }
      }

      const enriched = appendDeveloperFooter(items, rawTarget);
      setInspectedElement(null);
      setFocusedActionIndex(-1);
      setPositionedCoords({ left: event.clientX, top: event.clientY });
      setMenuState({
        x: event.clientX,
        y: event.clientY,
        header,
        items: enriched,
        targetEl: rawTarget,
      });
    }

    window.addEventListener('contextmenu', handleGlobalContextMenu);
    return () => window.removeEventListener('contextmenu', handleGlobalContextMenu);
  }, [
    activePage,
    appendDeveloperFooter,
    isCloudConnected,
    notifyCopy,
    onNavigate,
    onNotify,
    onOpenSettings,
    onOpenSignIn,
    onStartTutorial,
  ]);

  // Measure and viewport-clamp the rendered context menu so it never clips off-screen.
  useLayoutEffect(() => {
    if (!menuState || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = menuState.x;
    let top = menuState.y;

    if (left + rect.width + VIEWPORT_PADDING > vw) {
      left = Math.max(VIEWPORT_PADDING, menuState.x - rect.width);
    }
    if (top + rect.height + VIEWPORT_PADDING > vh) {
      top = Math.max(VIEWPORT_PADDING, menuState.y - rect.height);
    }

    left = Math.max(VIEWPORT_PADDING, Math.min(left, vw - rect.width - VIEWPORT_PADDING));
    top = Math.max(VIEWPORT_PADDING, Math.min(top, vh - rect.height - VIEWPORT_PADDING));

    setPositionedCoords({ left, top });
  }, [menuState]);

  const actionableItems = useMemo(
    () =>
      menuState
        ? menuState.items.filter(
            (item): item is Extract<ContextMenuItem, { type: 'action' }> =>
              item.type === 'action' && !item.disabled,
          )
        : [],
    [menuState],
  );

  // Close menu on outside click, Escape, scroll, resize, or blur; support arrow keys.
  useEffect(() => {
    if (!menuState) return;

    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      closeContextMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeContextMenu();
        return;
      }
      if (actionableItems.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusedActionIndex((prev) => (prev + 1) % actionableItems.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusedActionIndex((prev) =>
          prev <= 0 ? actionableItems.length - 1 : prev - 1,
        );
      } else if (event.key === 'Enter' && focusedActionIndex >= 0) {
        event.preventDefault();
        const chosen = actionableItems[focusedActionIndex];
        if (chosen) {
          closeContextMenu();
          chosen.onSelect();
        }
      }
    }

    function handleScroll(event: Event) {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      closeContextMenu();
    }

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('blur', closeContextMenu);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeContextMenu);
      window.removeEventListener('blur', closeContextMenu);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [actionableItems, closeContextMenu, focusedActionIndex, menuState]);

  // Allow dismissing the built-in Element Inspector with Escape or outside click.
  useEffect(() => {
    if (!inspectedElement) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setInspectedElement(null);
      }
    }
    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && inspectorRef.current?.contains(target)) return;
      setInspectedElement(null);
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [inspectedElement]);

  const contextValue = useMemo<ContextMenuContextValue>(
    () => ({ openContextMenu, closeContextMenu }),
    [closeContextMenu, openContextMenu],
  );

  const focusedActionId =
    focusedActionIndex >= 0 ? actionableItems[focusedActionIndex]?.id : undefined;

  return (
    <ContextMenuContext.Provider value={contextValue}>
      {children}

      {menuState &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            className="app-context-menu"
            role="menu"
            aria-label={menuState.header ? `${menuState.header} context menu` : 'Context menu'}
            style={{ left: `${positionedCoords.left}px`, top: `${positionedCoords.top}px` }}
          >
            {menuState.header && (
              <div className="app-context-menu-header">{menuState.header}</div>
            )}

            <div className="app-context-menu-list">
              {menuState.items.map((item) => {
                if (item.type === 'separator') {
                  return <div key={item.id} className="app-context-menu-sep" role="separator" />;
                }
                if (item.type === 'label') {
                  return (
                    <div key={item.id} className="app-context-menu-label">
                      {item.label}
                    </div>
                  );
                }

                const isFocused = focusedActionId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    className={`app-context-menu-item ${item.danger ? 'is-danger' : ''} ${
                      item.active ? 'is-active' : ''
                    } ${isFocused ? 'is-focused' : ''}`}
                    onMouseEnter={() => {
                      const idx = actionableItems.findIndex((entry) => entry.id === item.id);
                      setFocusedActionIndex(idx);
                    }}
                    onClick={() => {
                      if (item.disabled) return;
                      closeContextMenu();
                      item.onSelect();
                    }}
                  >
                    <span className="app-context-menu-icon" aria-hidden="true">
                      {item.icon ?? (item.active ? <PixelCheckIcon width={12} height={12} /> : null)}
                    </span>
                    <span className="app-context-menu-text">{item.label}</span>
                    {item.active && (
                      <span className="app-context-menu-active-dot" aria-hidden="true" />
                    )}
                    {item.shortcut && (
                      <span className="app-context-menu-shortcut">{item.shortcut}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}

      {inspectedElement &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              className="app-inspector-highlight"
              aria-hidden="true"
              style={{
                left: `${inspectedElement.rect.left}px`,
                top: `${inspectedElement.rect.top}px`,
                width: `${inspectedElement.rect.width}px`,
                height: `${inspectedElement.rect.height}px`,
              }}
            />
            <aside
              ref={inspectorRef}
              className="app-element-inspector"
              role="dialog"
              aria-label="Element Inspector"
            >
              <div className="app-inspector-header">
                <span className="app-inspector-title">
                  <PixelTerminalIcon width={13} height={13} />
                  <span>Element Inspector</span>
                </span>
                <button
                  type="button"
                  className="app-inspector-close"
                  onClick={() => setInspectedElement(null)}
                  aria-label="Close element inspector"
                >
                  <PixelCloseIcon width={11} height={11} />
                </button>
              </div>

              <div className="app-inspector-body">
                <div className="app-inspector-tag-row">
                  <code>
                    &lt;{inspectedElement.tag}
                    {inspectedElement.id ? `#${inspectedElement.id}` : ''}&gt;
                  </code>
                  <span className="app-inspector-dims">
                    {inspectedElement.rect.width} × {inspectedElement.rect.height}px
                  </span>
                </div>

                {inspectedElement.classes.length > 0 && (
                  <div className="app-inspector-chips">
                    {inspectedElement.classes.map((cls) => (
                      <span key={cls} className="app-inspector-chip">
                        .{cls}
                      </span>
                    ))}
                  </div>
                )}

                <div className="app-inspector-row">
                  <span className="app-inspector-key">Selector</span>
                  <code className="app-inspector-val">{inspectedElement.selector}</code>
                </div>

                {inspectedElement.role && (
                  <div className="app-inspector-row">
                    <span className="app-inspector-key">Role</span>
                    <code className="app-inspector-val">{inspectedElement.role}</code>
                  </div>
                )}

                {inspectedElement.ariaLabel && (
                  <div className="app-inspector-row">
                    <span className="app-inspector-key">ARIA Label</span>
                    <span className="app-inspector-val">{inspectedElement.ariaLabel}</span>
                  </div>
                )}

                {inspectedElement.textPreview && (
                  <div className="app-inspector-row">
                    <span className="app-inspector-key">Text</span>
                    <span className="app-inspector-val">{inspectedElement.textPreview}</span>
                  </div>
                )}
              </div>

              <div className="app-inspector-footer">
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  onClick={() => {
                    void notifyCopy(inspectedElement.selector, 'CSS selector');
                  }}
                >
                  <PixelCopyIcon width={11} height={11} />
                  <span>Copy Selector</span>
                </button>
                <span className="app-inspector-tip">
                  DevTools: <kbd>{devToolsShortcut}</kbd> · Native menu: <kbd>⇧ Right-Click</kbd>
                </span>
              </div>
            </aside>
          </>,
          document.body,
        )}
    </ContextMenuContext.Provider>
  );
}

export { PixelUserIcon };
