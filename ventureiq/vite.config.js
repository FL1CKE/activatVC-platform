import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    proxy: {
      // AI-чат ассистента → Node.js сервер (порт 3001)
      '/api/chat': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Агенты и анализ → Python FastAPI backend (порт 8000)
      '/api/platform': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/platform/, '/api/v1'),
      },
    },
  },
})
