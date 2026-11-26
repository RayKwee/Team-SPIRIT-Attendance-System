import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PixelCloseIcon, PixelSearchIcon } from './PixelIcons';

interface CompactEmojiRaw {
  unicode: string;
  label: string;
  group?: number;
  order?: number;
  tags?: string[];
}

interface EmojiEntry {
  unicode: string;
  label: string;
  group: number;
  order: number;
  tags: string[];
  searchText: string;
}

type EmojiCategoryKey = 'recent' | 0 | 1 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

interface EmojiCategoryTab {
  key: EmojiCategoryKey;
  icon: string;
  label: string;
}

const EMOJI_CATEGORY_TABS: EmojiCategoryTab[] = [
  { key: 'recent', icon: '🕒', label: 'Recent' },
  { key: 0, icon: '😀', label: 'Smileys & Emotion' },
  { key: 1, icon: '👋', label: 'People & Body' },
  { key: 3, icon: '🐻', label: 'Animals & Nature' },
  { key: 4, icon: '🍕', label: 'Food & Drink' },
  { key: 5, icon: '🚀', label: 'Travel & Places' },
  { key: 6, icon: '⚽', label: 'Activities' },
  { key: 7, icon: '💡', label: 'Objects' },
  { key: 8, icon: '❤️', label: 'Symbols' },
  { key: 9, icon: '🏁', label: 'Flags' },
];

const RECENT_EMOJIS_STORAGE_KEY = 'team-spirit:recent-emojis:v1';
const DEFAULT_RECENT_EMOJIS = [
  '🔥',
  '✨',
  '😂',
  '👍',
  '🎉',
  '❤️',
  '🙌',
  '🚀',
  '👀',
  '💯',
  '🤔',
  '😎',
  '🥳',
  '🤖',
  '⚡',
  '🫶',
];

let cachedEmojiCatalog: EmojiEntry[] | null = null;
let catalogLoadPromise: Promise<EmojiEntry[]> | null = null;

async function loadEmojiCatalog(): Promise<EmojiEntry[]> {
  if (cachedEmojiCatalog) return cachedEmojiCatalog;
  if (!catalogLoadPromise) {
    catalogLoadPromise = import('emojibase-data/en/compact.json').then((mod) => {
      const rawList = (mod.default ?? mod) as CompactEmojiRaw[];
      const entries: EmojiEntry[] = [];
      for (const item of rawList) {
        if (!item || typeof item.unicode !== 'string' || typeof item.group !== 'number') {
          continue;
        }
        // Skip skin-tone / hair-style component modifiers (group 2).
        if (item.group === 2) continue;
        const tags = Array.isArray(item.tags) ? item.tags : [];
        const label = typeof item.label === 'string' ? item.label : '';
        entries.push({
          unicode: item.unicode,
          label,
          group: item.group,
          order: typeof item.order === 'number' ? item.order : 99999,
          tags,
          searchText: `${label} ${tags.join(' ')}`.toLowerCase(),
        });
      }
      entries.sort((a, b) => a.order - b.order);
      cachedEmojiCatalog = entries;
      return entries;
    });
  }
  return catalogLoadPromise;
}

function loadRecentEmojis(): string[] {
  if (typeof window === 'undefined') return DEFAULT_RECENT_EMOJIS;
  try {
    const raw = window.localStorage.getItem(RECENT_EMOJIS_STORAGE_KEY);
    if (!raw) return DEFAULT_RECENT_EMOJIS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_RECENT_EMOJIS;
    const filtered = parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
    return filtered.length > 0 ? filtered.slice(0, 24) : DEFAULT_RECENT_EMOJIS;
  } catch {
    return DEFAULT_RECENT_EMOJIS;
  }
}

function recordRecentEmoji(emoji: string): string[] {
  const current = loadRecentEmojis();
  const next = [emoji, ...current.filter((item) => item !== emoji)].slice(0, 24);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(RECENT_EMOJIS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors safely.
    }
  }
  return next;
}

export interface EmojiPickerPopupProps {
  isOpen: boolean;
  anchorEl: HTMLElement | null;
  title?: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const POPUP_WIDTH = 336;
const POPUP_HEIGHT = 388;
const VIEWPORT_MARGIN = 12;

/**
 * Full, searchable standard Unicode emoji picker popup (~1,900+ emojis from emojibase-data),
 * lazy-loaded on demand and styled natively for Team SPIRIT's dark Lounge UI.
 */
export function EmojiPickerPopup({
  isOpen,
  anchorEl,
  title = 'Pick an emoji',
  onSelect,
  onClose,
}: EmojiPickerPopupProps) {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const [catalog, setCatalog] = useState<EmojiEntry[] | null>(() => cachedEmojiCatalog);
  const [activeCategory, setActiveCategory] = useState<EmojiCategoryKey>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => loadRecentEmojis());
  const [hoveredEntry, setHoveredEntry] = useState<EmojiEntry | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 80, left: 20 });

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    setHoveredEntry(null);
    setRecentEmojis(loadRecentEmojis());

    if (!cachedEmojiCatalog) {
      let active = true;
      void loadEmojiCatalog().then((entries) => {
        if (active) setCatalog(entries);
      });
      return () => {
        active = false;
      };
    }
  }, [isOpen]);

  // Auto-focus search input when opening the picker.
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  // Compute viewport-clamped fixed coordinates anchored cleanly to the trigger button.
  useLayoutEffect(() => {
    if (!isOpen || !anchorEl) return;

    function updatePosition() {
      if (!anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(POPUP_WIDTH, vw - VIEWPORT_MARGIN * 2);
      const height = Math.min(POPUP_HEIGHT, vh - VIEWPORT_MARGIN * 2);

      // Prefer opening above the trigger if there's enough space, otherwise below.
      const spaceAbove = rect.top - VIEWPORT_MARGIN;
      const spaceBelow = vh - rect.bottom - VIEWPORT_MARGIN;
      let top: number;
      if (spaceAbove >= height || spaceAbove >= spaceBelow) {
        top = Math.max(VIEWPORT_MARGIN, rect.top - height - 8);
      } else {
        top = Math.min(vh - height - VIEWPORT_MARGIN, rect.bottom + 8);
      }

      // Align right edge with trigger right edge, clamped within viewport.
      let left = rect.right - width;
      if (left < VIEWPORT_MARGIN) {
        left = Math.min(rect.left, vw - width - VIEWPORT_MARGIN);
      }
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - width - VIEWPORT_MARGIN));

      setCoords({ top, left });
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorEl, isOpen]);

  // Close on Escape key or clicking outside the popup/anchor.
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (popupRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [anchorEl, isOpen, onClose]);

  const entryByUnicode = useMemo(() => {
    const map = new Map<string, EmojiEntry>();
    if (catalog) {
      for (const entry of catalog) {
        map.set(entry.unicode, entry);
      }
    }
    return map;
  }, [catalog]);

  const displayedEntries = useMemo<EmojiEntry[]>(() => {
    if (!catalog) return [];
    const q = searchQuery.trim().toLowerCase();
    if (q.length > 0) {
      const terms = q.split(/\s+/).filter(Boolean);
      const exactMatches: EmojiEntry[] = [];
      const prefixMatches: EmojiEntry[] = [];
      const partialMatches: EmojiEntry[] = [];

      for (const entry of catalog) {
        if (!terms.every((term) => entry.searchText.includes(term))) continue;
        const lowerLabel = entry.label.toLowerCase();
        if (lowerLabel === q || entry.tags.some((t) => t.toLowerCase() === q)) {
          exactMatches.push(entry);
        } else if (lowerLabel.startsWith(q) || entry.tags.some((t) => t.toLowerCase().startsWith(q))) {
          prefixMatches.push(entry);
        } else {
          partialMatches.push(entry);
        }
      }
      return [...exactMatches, ...prefixMatches, ...partialMatches];
    }

    if (activeCategory === 'recent') {
      const resolved: EmojiEntry[] = [];
      for (const unicode of recentEmojis) {
        const match = entryByUnicode.get(unicode);
        if (match) {
          resolved.push(match);
        } else {
          resolved.push({
            unicode,
            label: 'recent emoji',
            group: 0,
            order: 0,
            tags: [],
            searchText: '',
          });
        }
      }
      return resolved;
    }

    return catalog.filter((entry) => entry.group === activeCategory);
  }, [activeCategory, catalog, entryByUnicode, recentEmojis, searchQuery]);

  if (!isOpen || typeof document === 'undefined') return null;

  const activeCategoryLabel = searchQuery.trim()
    ? `Search Results (${displayedEntries.length})`
    : EMOJI_CATEGORY_TABS.find((tab) => tab.key === activeCategory)?.label ?? 'Emojis';

  function handlePick(entry: EmojiEntry) {
    setRecentEmojis(recordRecentEmoji(entry.unicode));
    onSelect(entry.unicode);
  }

  return createPortal(
    <div
      ref={popupRef}
      className="emoji-picker-popup"
      role="dialog"
      aria-label={title}
      style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
    >
      <div className="emoji-picker-search-row">
        <span className="emoji-picker-search-icon" aria-hidden="true">
          <PixelSearchIcon width={13} height={13} />
        </span>
        <input
          ref={searchInputRef}
          type="text"
          className="emoji-picker-search-input"
          placeholder="Search 1,900+ emojis (fire, laugh, heart...)"
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            if (gridRef.current) gridRef.current.scrollTop = 0;
          }}
          aria-label="Search emojis"
        />
        {searchQuery.length > 0 && (
          <button
            type="button"
            className="emoji-picker-clear-btn"
            onClick={() => {
              setSearchQuery('');
              searchInputRef.current?.focus();
            }}
            aria-label="Clear emoji search"
          >
            <PixelCloseIcon width={10} height={10} />
          </button>
        )}
      </div>

      {!searchQuery.trim() && (
        <div className="emoji-picker-tabs" role="tablist" aria-label="Emoji categories">
          {EMOJI_CATEGORY_TABS.map((tab) => (
            <button
              key={String(tab.key)}
              type="button"
              role="tab"
              aria-selected={activeCategory === tab.key}
              className={`emoji-picker-tab ${activeCategory === tab.key ? 'is-active' : ''}`}
              onClick={() => {
                setActiveCategory(tab.key);
                if (gridRef.current) gridRef.current.scrollTop = 0;
              }}
              title={tab.label}
              aria-label={tab.label}
            >
              <span>{tab.icon}</span>
            </button>
          ))}
        </div>
      )}

      <div className="emoji-picker-section-label">{activeCategoryLabel}</div>

      <div ref={gridRef} className="emoji-picker-grid-scroll">
        {!catalog ? (
          <div className="emoji-picker-status">Loading emoji library...</div>
        ) : displayedEntries.length === 0 ? (
          <div className="emoji-picker-status">
            No emojis found for &ldquo;{searchQuery.trim()}&rdquo;
          </div>
        ) : (
          <div className="emoji-picker-grid" role="grid" aria-label={activeCategoryLabel}>
            {displayedEntries.map((entry) => (
              <button
                key={`${entry.unicode}-${entry.order}`}
                type="button"
                className="emoji-picker-cell"
                title={entry.label}
                aria-label={entry.label || entry.unicode}
                onMouseEnter={() => setHoveredEntry(entry)}
                onFocus={() => setHoveredEntry(entry)}
                onClick={() => handlePick(entry)}
              >
                {entry.unicode}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="emoji-picker-footer" aria-live="polite">
        {hoveredEntry ? (
          <>
            <span className="emoji-picker-preview-glyph">{hoveredEntry.unicode}</span>
            <div className="emoji-picker-preview-meta">
              <strong className="emoji-picker-preview-name">{hoveredEntry.label}</strong>
              {hoveredEntry.tags.length > 0 && (
                <span className="emoji-picker-preview-tags">
                  {hoveredEntry.tags.slice(0, 4).join(', ')}
                </span>
              )}
            </div>
          </>
        ) : (
          <span className="emoji-picker-footer-hint">
            {catalog ? `${catalog.length.toLocaleString()} standard emojis ready` : title}
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}
