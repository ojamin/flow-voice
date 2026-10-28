import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['flow-voice:source'] },
  // Vitest's Node environment uses Vite's SSR conditions, not the client ones.
  ssr: { resolve: { conditions: ['flow-voice:source'] } },
  test: { environment: 'node', maxWorkers: 2 },
});
