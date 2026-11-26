import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { teamSpiritStaticCachePlugin } from './build/serviceWorker';

export default defineConfig({
  plugins: [react(), teamSpiritStaticCachePlugin()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        lounge: 'lounge.html',
        games: 'games.html',
        attendance: 'attendance.html',
        tracker: 'tracker.html',
        calendar: 'calendar.html',
        ideas: 'ideas.html',
        updates: 'updates.html',
      },
    },
  },
});
