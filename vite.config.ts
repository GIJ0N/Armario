/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// En GitHub Pages el sitio vive en /<repo>/; CI define VITE_BASE=/armario/.
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  // Recomendado por @sqlite.org/sqlite-wasm: que Vite no pre-empaquete el módulo (rompe la ruta del .wasm).
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Armario',
        short_name: 'Armario',
        description: 'Tu armario y outfits del día',
        lang: 'es',
        display: 'standalone',
        theme_color: '#f5f5f3',
        background_color: '#f5f5f3',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,wasm,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    testTimeout: 20_000,
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
})
