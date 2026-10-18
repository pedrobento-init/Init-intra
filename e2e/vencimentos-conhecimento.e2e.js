import { test, expect } from '@playwright/test';
import { loginLocal } from './helpers.js';

test('vencimentos: cadastrar, ver na faixa certa e renovar +1 ano', async ({ page }) => {
  await loginLocal(page, { hash: 'vencimentos' });
  await page.evaluate(() => navigateTo('vencimentos'));
  await expect(page.locator('#pageTitle')).toHaveText('Vencimentos');
  const venc = await page.evaluate(() => { const d = new Date(localDateISO() + 'T12:00:00'); d.setDate(d.getDate() + 5); return d.toISOString().slice(0, 10); });

  await page.locator('#topbarActionBtn').click();
  await page.locator('#vencForm select[name="tipo"]').selectOption('ssl');
  await page.locator('#vencForm input[name="dataVencimento"]').fill(venc);
  await page.locator('#vencForm input[name="descricao"]').fill('SSL E2E loja');
  await page.locator('#vencForm button[type="submit"]').click();

  const row = page.locator('.venc-row', { hasText: 'SSL E2E loja' });
  await expect(row).toContainText('Em 5 dias');
  await expect(page.locator('.ov-panel', { hasText: 'Próximos 7 dias' })).toContainText('SSL E2E loja');

  await row.getByRole('button', { name: 'Renovar' }).click();
  await page.getByRole('button', { name: '+1 ano' }).click();
  await page.locator('#modalBody').getByRole('button', { name: 'Renovar' }).click();
  await expect(page.locator('.ov-panel', { hasText: 'Mais adiante' })).toContainText('SSL E2E loja');
});

test('conhecimento: artigo novo aparece na busca pelo sintoma', async ({ page }) => {
  await loginLocal(page, { hash: 'conhecimento' });
  await page.evaluate(() => navigateTo('conhecimento'));
  await page.locator('#topbarActionBtn').click();
  await page.locator('#modalBody input[name="title"]').fill('Outlook pede senha toda hora');
  await page.locator('#modalBody textarea[name="content"]').fill('Causa: perfil corrompido. Solução: recriar o perfil do Outlook.');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#kbSearch').fill('outlook senha');
  await expect(page.locator('#kbResults .kb-row')).toHaveCount(1);
  await expect(page.locator('#kbResults')).toContainText('Outlook pede senha toda hora');
});

test('roteiro do dia: visitas do técnico em ordem, com Maps/Waze', async ({ page }) => {
  await loginLocal(page, { hash: 'fila' });
  await page.evaluate(() => {
    const cs = getClients();
    saveClient({ ...cs[0], address: 'Av. Paulista, 1000 - São Paulo' });
    saveClient({ ...cs[1], address: 'Rua Augusta, 500 - São Paulo' });
    const me = getUser().name;
    saveVisit({ clientId: cs[1].id, clientName: cs[1].name, operator: me, date: localDateISO(), time: '15:00', status: 'agendada', motivo: 'Segunda parada' });
    saveVisit({ clientId: cs[0].id, clientName: cs[0].name, operator: me, date: localDateISO(), time: '08:00', status: 'agendada', motivo: 'Primeira parada' });
    navigateTo('fila');
  });
  const stops = page.locator('.rt-stop');
  await expect(stops).toHaveCount(2);
  await expect(stops.nth(0)).toContainText('Primeira parada');
  await expect(stops.nth(0).locator('.rt-nav a', { hasText: 'Waze' })).toHaveAttribute('href', /waze\.com\/ul\?q=Av\.%20Paulista/);
  await expect(page.getByRole('link', { name: 'Rota completa' })).toHaveAttribute('href', /destination=Rua%20Augusta/);
});
