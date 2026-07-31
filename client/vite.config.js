import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.url?.includes('/admin/stream')) {
              proxyReq.setHeader('Accept', 'text/event-stream');
            }
          });
          proxy.on('error', (err, _req, res) => {
            console.error('proxy error', err.message);
            if (res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'API proxy failed — is server on :8000?' }));
            }
          });
        },
      },
      '/log_event': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        timeout: 30000,
      },
    },
  },
})
