import { test, expect } from '@playwright/test';
import { loginLocal } from './helpers.js';

// Projeto "mobile" (Pixel 7): navegação inferior e quadro deslizável.
test('barra inferior navega e quadro mostra a coluna visível', async ({ page }) => {
  await loginLocal(page, { name: 'Giovane', hash: '' });
  // Técnico cai na Minha fila
  await expect(page.locator('#pageTitle')).toHaveText('Minha fila');
  const bar = page.locator('#bottomNav');
  await expect(bar).toBeVisible();
  await expect(bar.locator('[data-page="fila"]')).toHaveClass(/is-active/);

  await bar.getByRole('button', { name: 'Pendências' }).click();
  await expect(page.locator('#pageTitle')).toHaveText('Pendências');
  await expect(page.locator('.kb-pager-label')).toContainText('1/');

  // Sem rolagem horizontal da página
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
