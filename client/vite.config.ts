import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the .NET server runs on :5000 and Vite on :5173; API and SignalR hub calls are proxied so
// the client can use relative URLs in both environments. The production build is emitted straight into the
// server's wwwroot so `dotnet run` serves the whole app.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/hubs': { target: 'http://localhost:5000', changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: '../server/Sailing.Server/wwwroot',
    emptyOutDir: true,
    target: 'es2019', // Safari 13+ on older iPads
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three'
          if (id.includes('@react-three/')) return 'r3f'
          if (id.includes('@microsoft/signalr')) return 'signalr'
        },
      },
    },
  },
})
