import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createThemeController } from '@divypandya/time-aware-theme/dom';
import { TimeAwareThemeProvider } from '@divypandya/time-aware-theme/react';
import { demoThemeSystem } from './theme-system';
import { App } from './App';
import './styles.css';

const controller = createThemeController({
  system: demoThemeSystem,
  document,
  window,
  defaultMode: 'time-aware'
});
controller.start();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root was not found.');
}

createRoot(container).render(
  <StrictMode>
    <TimeAwareThemeProvider controller={controller}>
      <App />
    </TimeAwareThemeProvider>
  </StrictMode>
);
