import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ai': { target: 'http://localhost:3000', // SSE 需要关闭缓冲
        configure: (proxy) => { proxy.on('proxyRes', (p) => p.headers && delete p.headers['x-accel-buffering']); } },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          grid: ['ag-grid-react', 'ag-grid-community'],   // 重型依赖单独 chunk
          realtime: ['socket.io-client'],
        },
      },
    },
  },
});
