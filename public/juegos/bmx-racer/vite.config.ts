import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, host: '127.0.0.1' },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep three in its own chunk so the game code stays cache-friendly
        // during iteration.
        //
        // FUNCTION form, not the object form. Vite 8 bundles with rolldown
        // rather than rollup, and rolldown accepts only the callback:
        // `manualChunks: { three: ['three'] }` type-checks, runs fine in dev
        // (which never bundles), and then fails the production build with
        // "TypeError: manualChunks is not a function". So `npm run dev` and
        // `npm run typecheck` both pass while `npm run build` — the only thing
        // a deploy actually runs — does not.
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
  // Shaders live in .ts files as template literals — no plugin, no loader, no external asset.
});
