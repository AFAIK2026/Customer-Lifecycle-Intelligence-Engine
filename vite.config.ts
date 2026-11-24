import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // `vite dev` doesn't run Vercel functions; `npm run dev:api` serves the Python one locally.
    proxy: {
      '/api/prospect-analysis': 'http://127.0.0.1:5174',
    },
  },
})
