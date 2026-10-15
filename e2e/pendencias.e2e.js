import { test, expect } from '@playwright/test';
import { loginLocal, penCard, penColumn } from './helpers.js';

test.describe('Pendências', () => {
  test.beforeEach(async ({ page }) => {
    await loginLocal(page, { hash: 'pendencias' });
    await expect(page.locator('.kanban-board')).toBeVisible();
  });

  test('criar pendência pelo formulário aparece em "Aberto"', async ({ page }) => {
    await page.locator('#topbarActionBtn').click();
    const modal = page.locator('#modal');
    await expect(modal.locator('#modalTitle')).toHaveText('Nova Pendência');
    await modal.locator('[name="assunto"]').fill('E2E — trocar nobreak');
    await modal.locator('[name="descricao"]').fill('Criada pelo teste ponta a ponta.');
    await modal.locator('[name="status"]').selectOption('aberto');
    await modal.getByRole('button', { name: 'Salvar' }).click();

    await expect(page.locator('#modalOverlay')).toBeHidden();
    await expect(penColumn(page, 'Aberto').locator('.kanban-card', { hasText: 'E2E — trocar nobreak' })).toBeVisible();
  });

  test('iniciar e pausar o cronômetro move entre colunas', async ({ page }) => {
    const card = penCard(page, 'Verificação mensal de backup');
    await expect(penColumn(page, 'Aberto')).toContainText('Verificação mensal de backup');

    // Iniciar → vai para Em Andamento com o tempo correndo
    await card.getByRole('button', { name: /Iniciar cronômetro/ }).click();
    const running = penColumn(page, 'Em Andamento').locator('.kanban-card', { hasText: 'Verificação mensal de backup' });
    await expect(running).toBeVisible();
    await expect(running.locator('.kb-timer[data-running="true"]')).toBeVisible();

    // Pausar pelo detalhe → vai para Pausado
    await running.click();
    await page.locator('#modalBody').getByRole('button', { name: /Pausar/ }).first().click();
    await page.keyboard.press('Escape');
    await expect(penColumn(page, 'Pausado')).toContainText('Verificação mensal de backup');
  });

  test('menu ⋯ do card muda status e responsável sem abrir o detalhe', async ({ page }) => {
    const card = penCard(page, 'Atualização do antivírus');
    await card.hover();
    await card.getByRole('button', { name: /Ações rápidas/ }).click();
    const menu = page.getByRole('menu');
    await menu.getByRole('menuitem', { name: 'Pausado' }).click();
    await expect(page.locator('#modalOverlay')).toBeHidden();
    await expect(penColumn(page, 'Pausado')).toContainText('Atualização do antivírus');

    const moved = penCard(page, 'Atualização do antivírus');
    await moved.hover();
    await moved.getByRole('button', { name: /Ações rápidas/ }).click();
    await page.getByRole('menu').getByRole('menuitemradio', { name: 'Giovane' }).click();
    await expect(penCard(page, 'Atualização do antivírus').locator('.kc-resp')).toHaveText('Giovane');
  });

  test('nova pendência a partir de modelo já nasce com checklist', async ({ page }) => {
    await page.locator('#topbarActionBtn').click();
    const modal = page.locator('#modal');
    const tplValue = await modal.locator('#penTemplateSel option', { hasText: 'Onboarding' }).first().getAttribute('value');
    await modal.locator('#penTemplateSel').selectOption(tplValue);
    await expect(modal.locator('#penTemplateHint')).toContainText('checklist');
    await expect(modal.locator('[name="assunto"]')).not.toHaveValue('');
    await modal.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.locator('#modalOverlay')).toBeHidden();

    const count = await page.evaluate(() => {
      const p = getPendencias().find((x) => /Onboarding/.test(x.assunto || ''));
      return p && Array.isArray(p.checklist) ? p.checklist.length : 0;
    });
    expect(count).toBeGreaterThan(2);
  });
});
