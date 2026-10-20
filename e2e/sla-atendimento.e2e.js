import { test, expect } from '@playwright/test';
import { loginLocal, penColumn } from './helpers.js';

test('abertura rápida: cria pendência de suporte com solicitante, canal, categoria e prazo pelo SLA', async ({ page }) => {
  await loginLocal(page, { hash: 'pendencias' });
  await page.locator('#topbarActionBtn').click();
  const modal = page.locator('#modal');
  await expect(modal.locator('#modalTitle')).toHaveText('Nova pendência');
  await expect(page.locator('#prAssunto')).toBeFocused();

  await page.locator('#prCliente').selectOption({ label: 'Padaria Central' });
  await page.locator('#prAssunto').fill('E2E — impressora do caixa');
  await page.locator('#prCategoria').selectOption('impressora');
  await page.locator('#prPrioridade').selectOption('alta');
  await expect(modal.locator('[data-sla-hint]')).toHaveText('1ª resposta em 4h úteis · prazo 1 dia útil');
  await page.locator('#prSolicitante').fill('Marta');
  await page.locator('#prCanal').selectOption('whatsapp');
  await modal.getByRole('button', { name: 'Criar pendência' }).click();
  await expect(page.locator('#modalOverlay')).toBeHidden();

  const card = penColumn(page, 'Aberto').locator('.kanban-card', { hasText: 'E2E — impressora do caixa' });
  await expect(card).toBeVisible();
  const saved = await page.evaluate(() => getPendencias().find((p) => p.assunto === 'E2E — impressora do caixa'));
  const today = await page.evaluate(() => localDateISO());
  const esperado = await page.evaluate((t) => slaPrazoSugerido('alta', t), today);
  expect(saved).toMatchObject({ tipo: 'Suporte', status: 'aberto', descricao: 'E2E — impressora do caixa', solicitante: 'Marta',
    canal: 'whatsapp', categoria: 'impressora', deadline: esperado, clientName: 'Padaria Central' });
  expect(saved.firstResponseDue).toBeTruthy();
  expect(saved.firstResponseAt).toBeFalsy();

  // Detalhe mostra os dados; a 1ª nota registra a 1ª resposta.
  await card.click();
  const body = page.locator('#modalBody');
  await expect(body).toContainText('Marta');
  await expect(body).toContainText('WhatsApp');
  await expect(body).toContainText('Impressora');
  await body.locator('#newNoteText').fill('Falei com a Marta, vou passar lá.');
  await body.getByRole('button', { name: /Postar/ }).click();
  await expect(body).toContainText(/Respondida em .* por /);
  const depois = await page.evaluate(() => getPendencias().find((p) => p.assunto === 'E2E — impressora do caixa'));
  expect(depois.firstResponseAt).toBeTruthy();
});

test('formulário completo: prazo sugerido acompanha a prioridade até a pessoa escolher a data', async ({ page }) => {
  await loginLocal(page, { hash: 'pendencias' });
  await page.locator('#topbarActionBtn').click();
  await page.locator('#modal').getByRole('button', { name: 'Formulário completo' }).click();
  const form = page.locator('#modalBody form');
  const today = await page.evaluate(() => localDateISO());
  const sug = (pri) => page.evaluate(([p, t]) => slaPrazoSugerido(p, t), [pri, today]);
  await expect(form.locator('[name="deadline"]')).toHaveValue(await sug('media'));
  await form.locator('[name="priority"]').selectOption('critica');
  await expect(form.locator('[name="deadline"]')).toHaveValue(await sug('critica'));
  await form.locator('[name="deadline"]').fill('2030-01-15');
  await form.locator('[name="priority"]').selectOption('baixa');
  await expect(form.locator('[name="deadline"]')).toHaveValue('2030-01-15');
});

test('Prazos: 1ª resposta atrasada e problemas recorrentes por cliente e categoria', async ({ page }) => {
  await loginLocal(page, { hash: 'prazos' });
  await page.evaluate(() => {
    const now = Date.now();
    const iso = (msAgo) => new Date(now - msAgo).toISOString();
    const c = getClients().find((x) => x.name === 'Padaria Central');
    const base = { clientId: c.id, clientName: c.name, tipo: 'Suporte', responsible: 'Pedro', priority: 'media', team: c.team || 'init' };
    const list = getPendencias();
    list.push({ ...base, id: 'E2E-R1', assunto: 'Rede caiu', descricao: 'x', status: 'aberto', categoria: 'rede', createdAt: iso(3 * 86400000),
      firstResponseDue: iso(3600000), notes: [] });
    for (let i = 0; i < 3; i++) {
      list.push({ ...base, id: 'E2E-I' + i, assunto: 'Impressora ' + i, descricao: 'x', status: 'resolvido', categoria: 'impressora',
        canal: 'telefone', solicitante: 'Marta', createdAt: iso((i + 1) * 86400000), notes: [] });
    }
    dbSet(DB.PENDENCIAS, list);
    renderPrazos();
  });
  const area = page.locator('#contentArea');
  await expect(area.locator('.pz-resposta')).toContainText('Resposta atrasada');
  await expect(area.locator('.pz-resposta')).toContainText('Rede caiu');

  await area.getByRole('button', { name: 'Problemas recorrentes' }).click();
  await expect(area).toContainText('Problemas que se repetem');
  const item = area.locator('.rc-item').first();
  await expect(item).toContainText('Padaria Central');
  await expect(item).toContainText('Impressora');
  await expect(item).toContainText('3x em 90 dias');
  await expect(area).toContainText('Quem mais pede');
  await item.locator('.fila-row').first().click();
  await expect(page.locator('#modalTitle')).toContainText('Impressora');
});
