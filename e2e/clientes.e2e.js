import { test, expect } from '@playwright/test';
import { loginLocal } from './helpers.js';

test('preenchimento por CNPJ preserva dados manuais e preenche campos vazios', async ({ page }) => {
  await loginLocal(page, { hash: 'clientes' });
  await page.locator('#topbarActionBtn').click();
  const modal = page.locator('#modal');
  await modal.locator('[name="name"]').fill('Nome informado manualmente');
  await modal.locator('[name="cnpj"]').fill('06.990.590/0001-23');

  await page.route('https://brasilapi.com.br/api/cnpj/v1/06990590000123', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        nome_fantasia: 'Google Brasil',
        razao_social: 'Google Brasil Internet Ltda.',
        cnae_fiscal_descricao: 'Serviços de informação',
        descricao_tipo_de_logradouro: 'Avenida',
        logradouro: 'Brigadeiro Faria Lima',
        numero: '3477',
        complemento: '17º andar',
        bairro: 'Itaim Bibi',
        municipio: 'São Paulo',
        uf: 'SP',
      }),
    });
  });
  await modal.getByRole('button', { name: 'Preencher automaticamente' }).click();

  await expect(modal.locator('[name="name"]')).toHaveValue('Nome informado manualmente');
  await expect(modal.locator('[name="segment"]')).toHaveValue('Serviços de informação');
  await expect(modal.locator('[name="address"]')).toHaveValue('Avenida Brigadeiro Faria Lima, 3477 · 17º andar · Itaim Bibi · São Paulo - SP');
});
