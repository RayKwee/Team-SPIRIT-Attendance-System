import teamSpiritEmblem from '../assets/team-spirit-emblem.png';

/**
 * Registers the production static-asset Service Worker (`./sw.js`) and warms
 * static emblem graphics in browser memory/cache without caching live user data.
 */
export function registerStaticAssetCache(): void {
  if (typeof window === 'undefined') return;

  warmStaticGraphics();

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return;
  }

  const register = () => {
    const swUrl = new URL('sw.js', new URL(import.meta.env.BASE_URL, window.location.origin)).href;
    navigator.serviceWorker
      .register(swUrl, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' })
      .then((registration) => {
        void registration.update();
      })
      .catch(() => {
        // Ignore Service Worker registration failures in restricted browser contexts.
      });
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}

/** Preloads and decodes core static brand graphics during idle time. */
function warmStaticGraphics(): void {
  const run = () => {
    const img = new Image();
    img.decoding = 'async';
    img.src = teamSpiritEmblem;
    if (typeof img.decode === 'function') {
      void img.decode().catch(() => {});
    }
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 1500 });
  } else {
    globalThis.setTimeout(run, 150);
  }
}
