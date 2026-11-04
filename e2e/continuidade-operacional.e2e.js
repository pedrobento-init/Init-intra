import { test, expect } from '@playwright/test';
import { loginLocal } from './helpers.js';

test('linha do tempo do cliente abre a pendência', async ({ page }) => {
  await loginLocal(page, { hash: 'clientes' });
  await page.getByRole('row', { name: /Padaria Central/ }).click();
  await page.getByRole('tab', { name: 'Linha do tempo' }).click();

  const item = page.locator('.client-timeline .ov-it', { hasText: 'Atualização do antivírus' });
  await expect(item).toBeVisible();
  await item.click();

  await expect(page).toHaveURL(/#projetos\/PEN-4$/);
  await expect(page.locator('#contentArea')).toContainText('Atualização do antivírus');
});

test('visita guiada cria pendência do checklist selecionado', async ({ page }) => {
  await loginLocal(page, { hash: 'visitas' });
  await page.locator('#topbarActionBtn').click();
  const form = page.locator('#modal');
  await form.locator('[name="clientId"]').selectOption({ label: 'Padaria Central' });
  await form.locator('#visitAllDay').check();
  await form.locator('[name="motivo"]').fill('E2E — continuidade operacional');
  await form.getByRole('button', { name: /Salvar|Criar|Agendar/ }).click();
  await expect(page.locator('#modalOverlay')).toBeHidden();

  const visitId = await page.evaluate(() => {
    const visit = getVisits().find((v) => v.motivo === 'E2E — continuidade operacional');
    saveVisit({ ...visit, checklist: [
      { text: 'Revisar nobreak', done: false },
      { text: 'Item não selecionado', done: false },
    ] });
    return visit.id;
  });
  await page.locator('.vis-card', { hasText: 'E2E — continuidade operacional' }).click();
  await page.getByRole('button', { name: '▶ Iniciar atendimento' }).click();
  await page.getByRole('button', { name: '📍 Cheguei' }).click();
  await page.getByRole('button', { name: 'Próximo: Relatório' }).click();
  await page.locator('#cwRelatorio').fill('Atendimento concluído pelo teste E2E.');
  await page.getByRole('button', { name: 'Próximo: Assinatura' }).click();
  await page.getByRole('button', { name: 'Próximo: Concluir' }).click();

  await page.getByLabel('Revisar nobreak', { exact: true }).check();
  await page.getByLabel('Item não selecionado', { exact: true }).uncheck();
  await page.locator('#cwFollowupResponsible').selectOption('Giovane');
  await page.locator('#cwFollowupPriority').selectOption('alta');
  await page.locator('#cwFollowupNote').fill('Agendar retorno.');
  await page.getByRole('button', { name: '✅ Concluir visita' }).click();

  await expect(page.locator('#modalBody')).toContainText('Pendências geradas desta visita (1)');
  await expect(page.locator('#modalBody')).toContainText('Revisar nobreak');
  const pendencia = await page.evaluate((id) => getPendencias().find((p) => p.visitId === id), visitId);
  expect(pendencia).toMatchObject({
    assunto: 'Revisar nobreak',
    responsible: 'Giovane',
    priority: 'alta',
    status: 'aberto',
    visitId,
  });
});

test('central operacional exibe alerta e abre a pendência', async ({ page }) => {
  await loginLocal(page, { hash: 'dashboard' });
  const central = page.locator('section[aria-labelledby="ov-central"]');
  await expect(central).toContainText(/\d+ alertas?/);

  const alerta = central.locator('[data-action="operacionalAbrir"][data-arg="PEN-1"]', { hasText: 'Pendência vencida' });
  await expect(alerta).toBeVisible();
  await alerta.click();

  await expect(page).toHaveURL(/#projetos\/PEN-1$/);
  await expect(page.locator('#contentArea')).toContainText('Cabeamento estruturado');
});
