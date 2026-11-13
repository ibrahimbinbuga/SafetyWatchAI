import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Same origin as the default API URL so jsdom's XHR (used by axios) does not
    // apply CORS to MSW responses.
    environmentOptions: { jsdom: { url: 'http://localhost:8000/' } },
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/test/**', 'src/mocks/**', 'src/**/*.test.{js,jsx}'],
    },
  },
})
