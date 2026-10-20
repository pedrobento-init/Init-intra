import { test, expect } from '@playwright/test';
import { loginLocal } from './helpers.js';

test('abas do cliente e atalhos do Dashboard funcionam pelo teclado', async ({ page }) => {
  await loginLocal(page, { hash: 'dashboard' });
  // Atalho do Dashboard: foca com Tab (é role="button" com tabindex) e abre com Enter.
  const kpi = page.locator('.ov-k[role="button"]').first();
  await kpi.focus();
  await expect(kpi).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pageTitle')).not.toHaveText('Dashboard');

  await page.evaluate(() => viewClient(getClients()[0].id));
  const tabs = page.locator('#clientTabs [role="tab"]');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await tabs.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'false');
});

test('Esc com formulário alterado pede confirmação antes de fechar', async ({ page }) => {
  await loginLocal(page);
  const open = () => page.evaluate(() => openModal('Teste', '<div class="form-group"><label class="form-label" for="tx">Campo</label><input class="form-input" id="tx"></div>'));
  const overlay = page.locator('#modalOverlay');

  // Sem alteração: fecha direto.
  await open();
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();

  // Com alteração: "Cancelar" na confirmação mantém o modal e o texto.
  await open();
  await page.locator('#tx').fill('não perder');
  page.once('dialog', (d) => d.dismiss());
  await page.locator('#tx').press('Escape');
  await expect(overlay).toBeVisible();
  await expect(page.locator('#tx')).toHaveValue('não perder');

  // Confirmando: fecha.
  page.once('dialog', (d) => d.accept());
  await page.locator('#tx').press('Escape');
  await expect(overlay).toBeHidden();
});

test('tema escuro troca o color-scheme dos controles nativos', async ({ page }) => {
  await loginLocal(page);
  const scheme = () => page.evaluate(() => getComputedStyle(document.body).colorScheme);
  const startDark = await page.evaluate(() => document.body.classList.contains('dark-theme'));
  expect(await scheme()).toBe(startDark ? 'dark' : 'light');
  await page.locator('#themeToggleBtn').click();
  expect(await scheme()).toBe(startDark ? 'light' : 'dark');
});
