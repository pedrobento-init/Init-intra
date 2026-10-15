// Helpers dos testes E2E.
import { expect } from '@playwright/test';

/**
 * Entra no app em modo local (sem Supabase configurado não há login real):
 * abre a sessão do operador de demonstração e inicia o app, como o login faria.
 */
export async function loginLocal(page, { name = 'Pedro', hash = 'pendencias' } = {}) {
  await page.goto('/#' + hash, { waitUntil: 'load' });
  // Durante o carregamento dos <script defer> uma consulta pode cair entre
  // scripts (variável ainda não inicializada): só considera pronto sem erro.
  await page.waitForFunction(() => {
    try { return typeof _startApp === 'function' && getOperators().length > 0; } catch (_) { return false; }
  });
  await page.evaluate((opName) => {
    const op = getOperators().find((o) => o.name === opName) || getOperators()[0];
    setSession(op.id);
    document.getElementById('loginOverlay').style.display = 'none';
    _startApp();
  }, name);
  await expect(page.locator('#pageTitle')).not.toBeEmpty();
}

/** Card do quadro pelo assunto. */
export function penCard(page, assunto) {
  return page.locator('.kanban-card', { hasText: assunto });
}

/** Coluna do quadro pelo rótulo ("Aberto", "Em Andamento"...). */
export function penColumn(page, label) {
  return page.locator('.kanban-col', { has: page.locator('.kanban-col-title', { hasText: label }) });
}
