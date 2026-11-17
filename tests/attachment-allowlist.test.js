import { createRequire as __storageReq } from 'node:module';
const { requireStorage } = __storageReq(import.meta.url)('./_storage.cjs');
import { describe, it, expect, beforeEach } from 'vitest';

// SEC-10: anexo só entra se extensão e MIME forem coerentes e estiverem na allowlist.
describe('allowlist de anexos (SEC-10)', () => {
  let s;
  beforeEach(() => {
    globalThis.getOperatorNames = () => [];
    globalThis.escapeHtml = (v) =>
      String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    globalThis.window = {
      addEventListener() {},
      ...(globalThis.window || {}),
      _supabaseAuthActive: false,
    };
    globalThis.getSession = () => ({ name: 'Teste' });
    globalThis.addLog = () => {};
    s = requireStorage();
  });

  const f = (name, type = '', size = 1000) => ({ name, type, size });

  it('aceita os tipos de negócio com MIME coerente', () => {
    expect(s.validateAttachmentFile(f('foto.png', 'image/png')).ok).toBe(true);
    expect(s.validateAttachmentFile(f('foto.jpg', 'image/jpeg')).ok).toBe(true);
    expect(s.validateAttachmentFile(f('laudo.pdf', 'application/pdf')).ok).toBe(true);
    expect(
      s.validateAttachmentFile(
        f('p.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      ).ok
    ).toBe(true);
    expect(s.validateAttachmentFile(f('n.txt', 'text/plain')).ok).toBe(true);
  });

  it('csv no Windows (ms-excel) e MIME vazio caem no tipo canônico da extensão', () => {
    expect(s.validateAttachmentFile(f('d.csv', 'application/vnd.ms-excel')).ok).toBe(true);
    const r = s.validateAttachmentFile(f('d.docx', ''));
    expect(r.ok).toBe(true);
    expect(r.mime).toContain('wordprocessingml');
    expect(s.validateAttachmentFile(f('x.pdf', 'application/octet-stream')).mime).toBe(
      'application/pdf'
    );
  });

  it('extensão em maiúsculas vale como minúscula', () => {
    const r = s.validateAttachmentFile(f('FOTO.PNG', 'image/png'));
    expect(r.ok).toBe(true);
    expect(r.ext).toBe('png');
    expect(s.validateAttachmentFile(f('PAYLOAD.HTML', 'text/html')).ok).toBe(false);
  });

  it('bloqueia svg e html, mesmo com MIME de imagem ou texto', () => {
    expect(s.validateAttachmentFile(f('x.svg', 'image/svg+xml')).ok).toBe(false);
    expect(s.validateAttachmentFile(f('x.svg', 'image/png')).ok).toBe(false);
    expect(s.validateAttachmentFile(f('x.html', 'text/plain')).ok).toBe(false);
    expect(s.validateAttachmentFile(f('x.htm', '')).ok).toBe(false);
  });

  it('bloqueia executáveis e scripts', () => {
    for (const n of ['a.exe', 'a.js', 'a.bat', 'a.ps1', 'a.sh', 'a.jar', 'a.docm']) {
      const r = s.validateAttachmentFile(f(n, 'application/pdf'));
      expect(r.ok, n).toBe(false);
      expect(r.error).toMatch(/não permitido/);
    }
  });

  it('extensão dupla: a.pdf.exe e a.exe.pdf são barrados', () => {
    expect(s.validateAttachmentFile(f('a.pdf.exe', 'application/pdf')).ok).toBe(false);
    const r = s.validateAttachmentFile(f('a.exe.pdf', 'application/pdf'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('.exe');
    expect(s.validateAttachmentFile(f('relatorio.v2.final.pdf', 'application/pdf')).ok).toBe(true);
  });

  it('MIME mentiroso: extensão pdf com MIME html/png é recusada', () => {
    const r = s.validateAttachmentFile(f('a.pdf', 'text/html'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/não confere/);
    expect(s.validateAttachmentFile(f('a.png', 'application/pdf')).ok).toBe(false);
  });

  it('sem extensão ou extensão desconhecida é recusado, com mensagem em pt-BR', () => {
    expect(s.validateAttachmentFile(f('LEIAME', 'text/plain')).error).toMatch(/extensão/);
    expect(s.validateAttachmentFile(f('arquivo.', 'text/plain')).ok).toBe(false);
    expect(s.validateAttachmentFile(f('a.xyz', '')).error).toMatch(/não permitido/);
    expect(s.validateAttachmentFile(f('.pdf', 'application/pdf')).ok).toBe(false);
  });

  it('mantém o limite de 2MB e rejeita tamanho inválido', () => {
    expect(s.validateAttachmentFile(f('a.pdf', 'application/pdf', 2 * 1024 * 1024 + 1)).error).toBe(
      'Arquivo excede o limite de 2MB.'
    );
    expect(s.validateAttachmentFile(f('a.pdf', 'application/pdf', NaN)).ok).toBe(false);
    expect(s.validateAttachmentFile(null).ok).toBe(false);
  });

  it('nome é sanitizado: caminho, controle, bidi (RLO) e ponto inicial', () => {
    expect(s.sanitizeAttachmentName('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(s.sanitizeAttachmentName('C:\\tmp\\a b.pdf')).toBe('a b.pdf');
    expect(s.sanitizeAttachmentName('..hidden.pdf')).toBe('hidden.pdf');
    expect(s.sanitizeAttachmentName('a\u0000b\n.pdf')).toBe('ab.pdf');
    expect(s.sanitizeAttachmentName('<img src=x onerror=1>.png')).not.toMatch(/[<>=]/);
    // RLO faz "fdp.exe" parecer "exe.pdf": o controle sai e a extensão real aparece
    const r = s.validateAttachmentFile(f('doc\u202Efdp.exe', 'application/pdf'));
    expect(r.ok).toBe(false);
    const long = 'x'.repeat(300) + '.pdf';
    expect(s.sanitizeAttachmentName(long).length).toBeLessThanOrEqual(100);
    expect(s.sanitizeAttachmentName(long).endsWith('.pdf')).toBe(true);
  });

  it('nome devolvido pela validação é o sanitizado', () => {
    expect(s.validateAttachmentFile(f('../x/foto.PNG', 'image/png')).name).toBe('foto.PNG');
  });

  it('addAttachment recusa svg e não grava nada no item', () => {
    const store = { clients: [{ id: 'C1', attachments: [] }] };
    globalThis.getCacheStore = () => store.clients;
    globalThis.setCacheStore = (_t, v) => {
      store.clients = v;
    };
    const r = s.addAttachment('clients', 'C1', {
      name: 'x.svg',
      mimeType: 'image/svg+xml',
      size: 10,
      data: 'data:image/svg+xml;base64,AAAA',
    });
    expect(r.error).toMatch(/não permitido/);
    expect(store.clients[0].attachments).toHaveLength(0);
  });

  it('addClientDocument também recusa html e aceita pdf com nome sanitizado', () => {
    const store = { clients: [{ id: 'C1', documents: [] }] };
    globalThis.getCacheStore = () => store.clients;
    globalThis.setCacheStore = (_t, v) => {
      store.clients = v;
    };
    expect(
      s.addClientDocument('C1', { name: 'x.html', mimeType: 'text/html', size: 10 }).error
    ).toMatch(/não permitido/);
    const ok = s.addClientDocument('C1', {
      name: '../c.pdf',
      mimeType: 'application/pdf',
      size: 10,
    });
    expect(ok.success).toBe(true);
    expect(ok.document.name).toBe('c.pdf');
  });

  it('upload ao Storage nunca acontece para tipo bloqueado', async () => {
    let uploaded = false;
    globalThis.window._supabaseAuthActive = true;
    globalThis.isSupabaseConnected = () => true;
    globalThis.supabaseClient = {
      storage: {
        from: () => ({
          upload: async () => {
            uploaded = true;
            return { error: null };
          },
          getPublicUrl: () => ({ data: {} }),
        }),
      },
    };
    expect(
      await s._uploadAttachmentToStorage('clients', 'C1', 'A1', f('x.svg', 'image/svg+xml'))
    ).toBeNull();
    expect(uploaded).toBe(false);
    const ok = await s._uploadAttachmentToStorage(
      'clients',
      'C1',
      'A1',
      f('../a b.pdf', 'application/pdf')
    );
    expect(ok.path).toBe('clients/C1/A1-a b.pdf');
    expect(uploaded).toBe(true);
  });

  it('render: registro legado svg/html não vira <img> nem link; png vira miniatura', () => {
    expect(s.attachmentRecordAllowed({ name: 'a.svg', mimeType: 'image/svg+xml' })).toBe(false);
    expect(s.attachmentIsRasterImage({ name: 'a.svg', mimeType: 'image/svg+xml' })).toBe(false);
    expect(s.attachmentIsRasterImage({ name: 'a.png', mimeType: 'image/png' })).toBe(true);
    expect(s.attachmentIsRasterImage({ name: 'a.pdf', mimeType: 'application/pdf' })).toBe(false);

    const store = {
      clients: [
        {
          id: 'C1',
          attachments: [
            {
              id: 'A1',
              name: 'evil.svg',
              mimeType: 'image/svg+xml',
              size: 1,
              data: 'data:image/svg+xml;base64,AAAA',
              uploadedBy: 'x',
              uploadedAt: '2020-01-01',
            },
          ],
        },
      ],
    };
    globalThis.getCacheStore = () => store.clients;
    globalThis.formatDateTime = () => '';
    const box = { innerHTML: '', isConnected: true };
    globalThis.document = { getElementById: () => box };
    s.renderAttachmentList('clients', 'C1', 'box');
    expect(box.innerHTML).not.toContain('<img');
    expect(box.innerHTML).not.toContain('data:image/svg');
    expect(box.innerHTML).toContain('bloqueado');
  });

  it('abrir anexo: só https ou data: de imagem raster', () => {
    expect(s.isSafeAttachmentOpenUrl('https://x.supabase.co/a?token=1')).toBe(true);
    expect(s.isSafeAttachmentOpenUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(s.isSafeAttachmentOpenUrl('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(s.isSafeAttachmentOpenUrl('data:text/html;base64,AAAA')).toBe(false);
    expect(s.isSafeAttachmentOpenUrl('javascript:alert(1)')).toBe(false);
    expect(s.isSafeAttachmentOpenUrl(undefined)).toBe(false);
  });
});
