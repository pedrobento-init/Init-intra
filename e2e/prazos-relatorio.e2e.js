import { test, expect } from '@playwright/test';
import { loginLocal } from './helpers.js';

test('prazos: KPIs, agrupar por cliente e abrir a pendência pela lista', async ({ page }) => {
  await loginLocal(page, { hash: 'pendencias' });
  await page.evaluate(() => {
    const c = getClients()[0];
    const d = (n) => { const x = new Date(localDateISO() + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    savePendencia({ assunto: 'E2E vencida', tipo: 'tarefa', status: 'aberto', priority: 'alta', responsible: 'Pedro', clientId: c.id, clientName: c.name, deadline: d(-2) });
    savePendencia({ assunto: 'E2E hoje', tipo: 'tarefa', status: 'aberto', priority: 'media', responsible: 'Pedro', clientId: c.id, clientName: c.name, deadline: d(0) });
  });
  await page.evaluate(() => navigateTo('prazos'));
  await expect(page.locator('#pageTitle')).toHaveText('Prazos e SLA');
  await expect(page.locator('.pz-kpis .ov-k').first()).not.toContainText(/^0/);

  await page.getByRole('button', { name: 'Por cliente' }).click();
  await expect(page.locator('.ov-h2')).toHaveText('Por cliente');
  const group = page.locator('.pz-group', { hasText: await page.evaluate(() => getClients()[0].name) });
  await group.locator('.pz-head').click();
  await expect(group).toHaveClass(/is-open/);
  await group.locator('.fila-row', { hasText: 'E2E vencida' }).click();
  await expect(page.locator('#modalOverlay')).toBeVisible();
});

test('relatório mensal do cliente: prévia com visita e horas do mês', async ({ page }) => {
  await loginLocal(page, { hash: 'clientes' });
  const clientId = await page.evaluate(() => {
    const c = getClients()[0];
    saveVisit({ clientId: c.id, clientName: c.name, operator: 'Pedro', date: localDateISO(), time: '08:00', timeEnd: '09:30', status: 'concluida', motivo: 'E2E visita do mês' });
    return c.id;
  });
  await page.evaluate((id) => viewClient(id), clientId);
  await page.getByRole('button', { name: 'Relatório do mês (PDF)' }).click();
  // Mês atual (o padrão pode ser o anterior nos primeiros dias).
  await page.locator('#rptMonth').selectOption(await page.evaluate(() => localDateISO().slice(0, 7)));
  const rpt = page.locator('#rptPreview .rpt');
  await expect(rpt).toContainText('E2E visita do mês');
  await expect(rpt).toContainText('1h 30min');
  await expect(page.locator('#rptPrintBtn')).toBeEnabled();
});
