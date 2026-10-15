// Testes ponta a ponta (navegador real) — `npm run test:e2e`.
// Sobe o app com o Vite numa porta própria e roda em modo local (sem
// Supabase): os dados de demonstração nascem a cada teste (contexto novo =
// IndexedDB limpo). Arquivos *.e2e.js para não colidirem com o Vitest.
import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
// Windows: usa o Edge já instalado (sem baixar navegador). Em outros
// sistemas/CI: Chromium do Playwright (`npx playwright install chromium`),
// ou force um canal com PW_CHANNEL=chrome|msedge.
const channel = process.env.PW_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // O service worker cachearia assets entre testes.
    serviceWorkers: 'block',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1366, height: 860 } }, testIgnore: '**/mobile.e2e.js' },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel }, testMatch: '**/mobile.e2e.js' },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
