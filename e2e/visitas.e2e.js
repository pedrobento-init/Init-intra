import { test, expect } from '@playwright/test';
import { loginLocal } from './helpers.js';

test('criar e concluir visita com relatório', async ({ page }) => {
  await loginLocal(page, { hash: 'visitas' });
  await expect(page.locator('#pageTitle')).toHaveText('Visitas Técnicas');

  // Criar
  await page.locator('#topbarActionBtn').click();
  const modal = page.locator('#modal');
  await modal.locator('[name="clientId"]').selectOption({ label: 'Padaria Central' });
  await modal.locator('#visitAllDay').check();
  await modal.locator('[name="motivo"]').fill('E2E — manutenção preventiva');
  await modal.getByRole('button', { name: /Salvar|Criar|Agendar/ }).click();
  await expect(page.locator('#modalOverlay')).toBeHidden();
  const card = page.locator('.vis-card', { hasText: 'Padaria Central' });
  await expect(card).toBeVisible();

  // Concluir (exige relatório)
  await card.click();
  await page.locator('#chgVisitStatus').selectOption('concluida');
  await page.getByRole('button', { name: 'Atualizar Status' }).click();
  await page.locator('#concludeRelatorio').fill('Troca de filtros e teste do nobreak.');
  await page.locator('#modal').getByRole('button', { name: /Concluir/ }).click();

  await expect(page.locator('#modalBody')).toContainText('Troca de filtros e teste do nobreak.');
  const status = await page.evaluate(() => getVisits().find((v) => v.motivo === 'E2E — manutenção preventiva')?.status);
  expect(status).toBe('concluida');
});
