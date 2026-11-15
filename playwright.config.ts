import { defineConfig } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 4173)

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}/Armario/`,
    // Se usa el Chrome del sistema; no se descarga ningún navegador.
    launchOptions: { executablePath: '/usr/bin/google-chrome' },
    viewport: { width: 390, height: 800 },
  },
  webServer: {
    command: `VITE_BASE=/Armario/ npm run build && VITE_BASE=/Armario/ npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/Armario/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
