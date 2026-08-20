import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // file: links resolve 'react' from the repo root as well as from here, and
  // two React instances break hooks with "Cannot read properties of null
  // (reading 'useState')". Only bites a production build.
  resolve: { dedupe: ['react', 'react-dom'] },
  plugins: [react()]
});
