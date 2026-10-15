import { test, expect } from '@playwright/test';
import { loginLocal } from './helpers.js';

// PNG 64x48 gerado na hora (sem arquivo de fixture).
async function makePng(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    const g = c.getContext('2d'); g.fillStyle = '#2957F5'; g.fillRect(0, 0, 64, 48);
    return c.toDataURL('image/png').split(',')[1];
  });
  return { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

test('foto na visita: comprime, guarda no aparelho e mostra "Aguardando envio"', async ({ page }) => {
  await loginLocal(page, { hash: 'visitas' });
  // Visita de teste direto no banco local
  const visitId = await page.evaluate(() => saveVisit({ clientId: getClients()[0].id, clientName: getClients()[0].name, operator: 'Pedro', date: localDateISO(), allDay: true, motivo: 'E2E foto', status: 'agendada' }).id);
  await page.evaluate((id) => openVisitDetail(id), visitId);
  await expect(page.locator('.vp-section')).toBeVisible();

  await page.locator('.vp-add input[type="file"]').setInputFiles(await makePng(page));
  const item = page.locator('.vp-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Aguardando envio');
  const stored = await page.evaluate(() => (getCacheKV('intra_visit_photos_queue', []) || []).map((q) => q.dataUrl.slice(0, 15)));
  expect(stored).toEqual(['data:image/jpeg']); // recodificada em JPEG

  // Ampliar e fechar
  await item.locator('.vp-thumb').click();
  await expect(page.locator('.vp-viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.vp-viewer')).toHaveCount(0);
});

test('auditoria: filtra por ação e pessoa e agrupa por dia', async ({ page }) => {
  await loginLocal(page, { hash: 'pendencias' });
  await page.evaluate(() => { addLog('Criou', 'Pendência', 'PEN-X', 'Registro E2E'); addLog('Editou', 'Visita', 'VIS-X', 'Outro registro'); });
  await page.evaluate(() => navigateTo('historico'));
  await expect(page.locator('#pageTitle')).toHaveText('Histórico de Atividades');
  await expect(page.locator('.audit-day-label').first()).toContainText('Hoje');

  await page.locator('#logActionFilter').selectOption('Criou');
  await expect(page.locator('#logsContainer')).toContainText('Registro E2E');
  await expect(page.locator('#logsContainer')).not.toContainText('Outro registro');
  await expect(page.locator('#auditSummary')).toContainText('registro');

  await page.locator('.audit-quick [data-p="today"]').click();
  await expect(page.locator('#logDateFrom')).not.toHaveValue('');
});
