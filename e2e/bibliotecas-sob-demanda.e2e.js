import { test, expect } from '@playwright/test';
import { loginLocal } from './helpers.js';

test('xlsx e mammoth não carregam na abertura; a planilha baixa a biblioteca quando é exportada', async ({ page }) => {
  const cdn = [];
  page.on('request', (r) => { if (/xlsx|mammoth/.test(r.url())) cdn.push(r.url()); });
  await loginLocal(page, { hash: 'equipamentos' });
  expect(cdn).toEqual([]);
  expect(await page.evaluate(() => typeof XLSX)).toBe('undefined');

  // Precisa de um equipamento na lista para exportar.
  await page.evaluate(() => {
    const c = getClients()[0];
    saveEquipamento({ clientId: c.id, clientName: c.name, tipo: 'notebook', descricao: 'E2E notebook', status: 'recebido', valor: 150 });
    renderEquipamentos();
  });
  const download = page.waitForEvent('download');
  await page.evaluate(() => exportEquipamentosPlanilha());
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^equipamentos_acerto_.*\.xlsx$/);
  expect(cdn.some((u) => u.includes('xlsx@0.18.5'))).toBe(true);
  expect(await page.evaluate(() => typeof XLSX)).toBe('object');
});

test('animações (motion) chegam depois que a tela abre', async ({ page }) => {
  await loginLocal(page, { hash: 'fila' });
  await expect.poll(() => page.evaluate(() => typeof Motion), { timeout: 10000 }).toBe('object');
});
