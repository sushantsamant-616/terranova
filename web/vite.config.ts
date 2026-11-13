import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the site runs on :5173 and forwards /api calls to the API on :4000.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:4000' } },
})
