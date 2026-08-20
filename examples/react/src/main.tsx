import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ThemeController } from '@divypandya/time-aware-theme/dom';
import { createThemeController } from '@divypandya/time-aware-theme/dom';
import { TimeAwareThemeProvider } from '@divypandya/time-aware-theme/react';
import { App } from './App';
import { presets } from './presets';
import './styles.css';

function Root() {
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const [controller, setController] = useState<ThemeController | null>(null);

  // The controller is created inside the effect, not in a useMemo, because
  // `dispose()` is terminal: a controller built during render and disposed by
  // StrictMode's second pass cannot be restarted, and the app dies with
  // "Theme controller has been disposed". Building it here means each pass
  // gets its own, and only the live one is ever handed to the provider.
  //
  // Switching preset takes the same path, since a controller owns one
  // schedule and there is no API for swapping it.
  useEffect(() => {
    const entry = presets.find((item) => item.id === presetId) ?? presets[0];
    if (!entry) {
      throw new Error('No presets are available.');
    }
    const next = createThemeController({
      system: entry.system,
      document,
      window,
      defaultMode: 'time-aware'
    });
    next.start();
    setController(next);
    return () => {
      next.dispose();
      setController((current) => (current === next ? null : current));
    };
  }, [presetId]);

  if (!controller) {
    return null;
  }

  return (
    <TimeAwareThemeProvider controller={controller}>
      <App presetId={presetId} onPresetChange={setPresetId} />
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
