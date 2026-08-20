import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ThemeController } from '@divypandya/time-aware-theme/dom';
import { createThemeController } from '@divypandya/time-aware-theme/dom';
import { TimeAwareThemeProvider } from '@divypandya/time-aware-theme/react';
import { App } from './App';
import { presetById, presets } from './presets';
import './styles.css';

/** Keeps the chosen preset in the URL, so a link carries the theme with it. */
function presetFromLocation(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('preset');
  return fromQuery && presets.some((entry) => entry.id === fromQuery)
    ? fromQuery
    : (presets[0]?.id ?? '');
}

function Root() {
  const [presetId, setPresetId] = useState(presetFromLocation);
  const [controller, setController] = useState<ThemeController | null>(null);

  // Created inside the effect rather than in a useMemo, because dispose() is
  // terminal: a controller built during render and disposed by StrictMode's
  // second pass cannot be restarted, and the app dies with "Theme controller
  // has been disposed". Switching preset takes the same path, since a
  // controller owns one schedule and there is no API for swapping it.
  useEffect(() => {
    const next = createThemeController({
      system: presetById(presetId).system,
      document,
      window,
      defaultMode: 'time-aware'
    });
    next.start();
    setController(next);
    return () => {
      next.dispose();
      // Deliberately not clearing the controller here. Doing so renders null
      // for a beat on every preset change, which reads as the page blanking.
      // The next effect replaces it, and a disposed controller is inert, so
      // whatever reaches the old one in between simply does nothing.
    };
  }, [presetId]);

  const choose = (id: string) => {
    setPresetId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('preset', id);
    window.history.replaceState(null, '', url);
  };

  if (!controller) {
    return null;
  }

  return (
    <TimeAwareThemeProvider controller={controller}>
      <App presetId={presetId} onPresetChange={choose} />
    </TimeAwareThemeProvider>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root was not found.');
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
