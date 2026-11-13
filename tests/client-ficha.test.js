import { createRequire as __partsReq } from 'node:module';
const { requireParts, partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const CLIENT = {
  id: 'CLI-1',
  name: '2CARTORIO',
  segment: 'Cartório',
  cnpj: '11.222.333/0001-44',
  owner: 'Ana',
  ownerPhone: '(11) 99999-0000',
  responsible: 'Bruno',
  responsiblePhone: '(11) 98888-7777',
  technician: 'Carla',
  milvusClientToken: 'mv_abc123',
  server: { type: 'Cloud (AWS)', os: 'Ubuntu 22.04', ip: '10.0.0.5', remoteAccess: 'AnyDesk', remoteId: '123 456 789', notes: '' },
  hosting: { provider: 'HostGator', panelUrl: 'https://panel.ex.com', user: 'admin', notes: '' },
  backup: { frequency: 'Diário', time: '03:00', destination: 'S3', tool: 'restic', lastCheck: '2024-05-01', lastBackupAt: '2024-05-02T03:10:00Z', lastBackupStatus: 'OK' },
  emails: { provider: 'Google', domain: 'ex.com', server: 'smtp.ex.com', port: '587', quota: '30GB' },
  notes: 'senha do rack na gaveta',
  licenses: [{ software: 'ESET', expiry: '2025-01-01', key: 'AAAA-BBBB-CCCC' }],
  createdAt: '2023-06-01T12:00:00Z',
  updatedAt: '2024-05-02T10:00:00Z',
  updatedBy: 'Pedro',
};

describe('Ficha TI', () => {
  let mod;
  let pendencias;

  beforeEach(() => {
    pendencias = [];
    globalThis.getClientById = (id) => (id === CLIENT.id ? CLIENT : null);
    globalThis.formatDate = (iso) => (iso ? 'DATA:' + String(iso).slice(0, 10) : '-');
    globalThis.formatDateTime = (iso) => (iso ? 'DATETIME:' + String(iso) : '-');
    globalThis.escapeHtml = (v) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    globalThis.getPendencias = () => pendencias;
    globalThis.getMyPendencias = () => pendencias;
    mod = requireParts('clients');
  });

  describe('modelo (campos, acesso rápido, resumo)', () => {
    it('todo campo do Acesso rápido existe no modelo de seções', () => {
      const keys = mod.FICHA_SECTIONS.flatMap(s => s.fields.map(f => f.k));
      mod.FICHA_QUICK_KEYS.forEach(k => expect(keys).toContain(k));
    });
    it('seções têm id, título, ícone e contagem coerente', () => {
      const ids = mod.FICHA_SECTIONS.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      mod.FICHA_SECTIONS.forEach(s => {
        expect(s.title).toBeTruthy();
        expect(s.icon).toBeTruthy();
        expect(typeof mod.cfSectionCount(s, CLIENT)).toBe('string');
      });
    });
    it('chaves aninhadas usam ponto (server.ip, backup.frequency, ...)', () => {
      const keys = mod.FICHA_SECTIONS.flatMap(s => s.fields.map(f => f.k));
      expect(keys).toContain('server.ip');
      expect(keys).toContain('backup.lastBackupAt');
      expect(keys.filter(k => k.includes('.')).length).toBeGreaterThan(10);
    });
  });

  describe('leitura/escrita de campos', () => {
    it('cfGet lê chaves simples e aninhadas, com fallback vazio', () => {
      expect(mod.cfGet(CLIENT, 'segment')).toBe('Cartório');
      expect(mod.cfGet(CLIENT, 'server.ip')).toBe('10.0.0.5');
      expect(mod.cfGet(CLIENT, 'server.nope')).toBe('');
      expect(mod.cfGet(null, 'segment')).toBe('');
    });
    it('cfSet devolve cópia e preserva os irmãos do objeto aninhado', () => {
      const next = mod.cfSet(CLIENT, 'server.ip', '10.0.0.9');
      expect(next.server.ip).toBe('10.0.0.9');
      expect(next.server.os).toBe('Ubuntu 22.04');
      expect(CLIENT.server.ip).toBe('10.0.0.5');
      expect(next).not.toBe(CLIENT);
      const top = mod.cfSet(CLIENT, 'notes', 'novo');
      expect(top.notes).toBe('novo');
      expect(CLIENT.notes).toContain('gaveta');
    });
    it('cfFilled considera vazio como não preenchido', () => {
      expect(mod.cfFilled('x')).toBe(true);
      expect(mod.cfFilled('  ')).toBe(false);
      expect(mod.cfFilled('')).toBe(false);
      expect(mod.cfFilled(null)).toBe(false);
      expect(mod.cfFilled(0)).toBe(true);
    });
  });

  describe('progresso da ficha', () => {
    it('conta campos preenchidos sobre o total do modelo', () => {
      const { filled, total } = mod.cfProgress(CLIENT);
      expect(total).toBe(32); // + Endereço (roteiro do dia)
      expect(filled).toBe(29);
      expect(Math.round((filled / total) * 100)).toBe(91);
    });
    it('ficha vazia fica em 0', () => {
      const { filled, total } = mod.cfProgress({ id: 'X' });
      expect(filled).toBe(0);
      expect(total).toBeGreaterThan(0);
    });
    it('contagem por seção reflete só aquela seção', () => {
      const backup = mod.FICHA_SECTIONS.find(s => s.id === 'backup');
      expect(mod.cfSectionCount(backup, CLIENT)).toBe('7 de 7 preenchidos');
      const obs = mod.FICHA_SECTIONS.find(s => s.id === 'observacoes');
      expect(mod.cfSectionCount(obs, { id: 'Y' })).toBe('Nenhum dado preenchido');
      const lics = mod.FICHA_SECTIONS.find(s => s.id === 'licencas');
      expect(mod.cfSectionCount(lics, CLIENT)).toBe('1 licença');
      expect(mod.cfSectionCount(lics, { id: 'Z', licenses: [] })).toBe('Nenhuma licença');
    });
  });

  describe('datas', () => {
    it('cfDateTimeLocalValue normaliza para o formato do input', () => {
      expect(mod.cfDateTimeLocalValue('2024-05-02T03:10:00.000Z')).toBe('2024-05-02T03:10');
      expect(mod.cfDateTimeLocalValue('2024-05-02T03:10')).toBe('2024-05-02T03:10');
      expect(mod.cfDateTimeLocalValue('2024-05-02')).toBe('2024-05-02T00:00');
      expect(mod.cfDateTimeLocalValue('')).toBe('');
      expect(mod.cfDateTimeLocalValue(null)).toBe('');
      expect(mod.cfDateTimeLocalValue('qualquer coisa')).toBe('');
    });
    it('cfFormatWhen usa data quando é só data e data+hora quando tem hora', () => {
      expect(mod.cfFormatWhen('2024-05-01')).toBe('DATA:2024-05-01');
      expect(mod.cfFormatWhen('2024-05-02T03:10:00Z')).toBe('DATETIME:2024-05-02T03:10:00Z');
      expect(mod.cfFormatWhen('')).toBe('');
      expect(mod.cfFormatWhen(null)).toBe('');
    });
    it('cfClientSince: 1ª pendência > createdAt > vazio', () => {
      pendencias = [
        { clientId: 'CLI-1', createdAt: '2024-01-15T10:00:00Z' },
        { clientId: 'CLI-1', createdAt: '2023-08-01T10:00:00Z' },
        { clientId: 'OUTRO', createdAt: '2022-01-01T10:00:00Z' },
      ];
      expect(mod.cfClientSince(CLIENT, pendencias)).toBe('DATA:2023-08-01');
      expect(mod.cfClientSince({ id: 'X' }, pendencias)).toBe('');
      expect(mod.cfClientSince({ id: 'X', createdAt: '2023-06-01T12:00:00Z' }, [])).toBe('DATA:2023-06-01');
      expect(mod.cfClientSince({ id: 'X' }, [])).toBe('');
    });
  });

  describe('cabeçalho do modal', () => {
    it('mostra data da edição e autor', () => {
      const meta = mod.cfUpdatedMeta(CLIENT);
      expect(meta).toContain('Atualizada em DATA:2024-05-');
      expect(meta).toContain(' por Pedro');
    });
    it('omite o trecho quando não há data ou autor', () => {
      expect(mod.cfUpdatedMeta({ id: 'X' })).toBe('');
      expect(mod.cfUpdatedMeta({ id: 'X', updatedAt: '2024-05-02T10:00:00Z' })).toBe('Atualizada em DATA:2024-05-02');
      expect(mod.cfUpdatedMeta(null)).toBe('');
    });
    it('escapa o nome do autor', () => {
      const meta = mod.cfUpdatedMeta({ id: 'X', updatedAt: '2024-05-02T10:00:00Z', updatedBy: '<script>x</script>' });
      expect(meta).toContain('&lt;script&gt;');
      expect(meta).not.toContain('<script>');
    });
  });

  describe('preenchimento automático por CNPJ', () => {
    const empresa = {
      nome_fantasia: 'Padaria Central',
      razao_social: 'Padaria Central LTDA',
      cnae_fiscal_descricao: 'Comércio de alimentos',
      descricao_tipo_de_logradouro: 'Rua',
      logradouro: 'das Flores',
      numero: '123',
      complemento: 'Sala 2',
      bairro: 'Centro',
      municipio: 'São Paulo',
      uf: 'SP',
    };

    it('mapeia nome fantasia, segmento e endereço completo', () => {
      expect(mod.clientCnpjFormData(empresa)).toEqual({
        name: 'Padaria Central',
        segment: 'Comércio de alimentos',
        address: 'Rua das Flores, 123 · Sala 2 · Centro · São Paulo - SP',
      });
    });

    it('usa a razão social quando não há nome fantasia', () => {
      expect(mod.clientCnpjFormData({ ...empresa, nome_fantasia: '' }).name).toBe('Padaria Central LTDA');
    });

    it('preenche somente campos vazios e restaura o botão', async () => {
      const fields = {
        cnpj: { value: '12.345.678/0001-90' },
        name: { value: 'Nome manual' },
        segment: { value: '' },
        address: { value: '' },
      };
      const button = {
        disabled: false,
        textContent: 'Preencher automaticamente',
        closest: () => ({ elements: fields }),
      };
      globalThis.fetch = async () => ({ ok: true, json: async () => empresa });
      globalThis.showToast = vi.fn();
      await mod.autoFillClientByCnpj(button);
      expect(fields.name.value).toBe('Nome manual');
      expect(fields.segment.value).toBe(empresa.cnae_fiscal_descricao);
      expect(fields.address.value).toContain('Rua das Flores, 123');
      expect(button.disabled).toBe(false);
      expect(button.textContent).toBe('Preencher automaticamente');
    });

    it('recusa CPF ou CNPJ incompleto sem consultar a API', async () => {
      globalThis.fetch = vi.fn();
      globalThis.showToast = vi.fn();
      const button = { closest: () => ({ elements: { cnpj: { value: '123.456.789-00' } } }) };
      await mod.autoFillClientByCnpj(button);
      expect(fetch).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith('Informe um CNPJ com 14 dígitos.', 'warning');
    });
  });

  describe('copiar resumo (whitelist)', () => {
    it('inclui o essencial da ficha', () => {
      const txt = mod.buildClientSummary('CLI-1');
      expect(txt).toContain('Ficha TI – 2CARTORIO');
      expect(txt).toContain('Segmento: Cartório');
      expect(txt).toContain('IP: 10.0.0.5');
      expect(txt).toContain('Contato: (11) 98888-7777');
      expect(txt).toContain('Último backup: 2024-05-02T03:10:00Z');
    });
    it('NUNCA leva token, chaves de licença nem observações', () => {
      const txt = mod.buildClientSummary('CLI-1');
      expect(txt).not.toContain('mv_abc123');
      expect(txt).not.toContain('AAAA-BBBB-CCCC');
      expect(txt).not.toContain('ESET');
      expect(txt).not.toContain('senha do rack');
    });
    it('omite campos vazios e devolve vazio para cliente inexistente', () => {
      const txt = mod.buildClientSummary('CLI-1');
      expect(txt).not.toMatch(/:\s*$/m);
      expect(mod.buildClientSummary('NAO-EXISTE')).toBe('');
    });
  });
});
