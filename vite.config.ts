import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleApiRequest } from './api/handlers.mjs';

function lexivueApiPlugin() {
  return {
    name: 'lexivue-api',
    configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api/')) {
          const handled = await handleApiRequest(req, res);
          if (handled !== false) return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), lexivueApiPlugin()],
  server: {
    port: 5173,
  },
});
