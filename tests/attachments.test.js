import { createRequire as __storageReq } from 'node:module';
const { requireStorage, storageSource } = __storageReq(import.meta.url)('./_storage.cjs');
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('_dataUrlToBlob (FASE 2 — backfill base64 para Storage)', () => {
  let storage;
  beforeEach(() => {
    globalThis.getOperatorNames = () => [];
    globalThis.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        storage = requireStorage();
  });
  it('converte dataURL png em Blob com mime e bytes corretos', () => {
    // 1x1 png
    const d = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const b = storage._dataUrlToBlob(d);
    expect(b).not.toBeNull();
    expect(b.type).toBe('image/png');
    expect(b.size).toBeGreaterThan(0);
  });
  it('converte texto simples e preserva conteúdo', async () => {
    const d = 'data:text/plain;base64,aGVsbG8=';
    const b = storage._dataUrlToBlob(d);
    expect(b.type).toBe('text/plain');
    expect(await b.text()).toBe('hello');
  });
  it('retorna null para entrada inválida (sem quebrar)', () => {
    expect(storage._dataUrlToBlob(null)).toBeNull();
    expect(storage._dataUrlToBlob('')).toBeNull();
    expect(storage._dataUrlToBlob('https://x.com/a.png')).toBeNull();
    expect(storage._dataUrlToBlob('data:;base64,!!!')).toBeNull();
  });
});

describe('Anexos com link assinado (bucket privado — 022)', () => {
  let storage;
  let calls;
  beforeEach(() => {
    globalThis.getOperatorNames = () => [];
    globalThis.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    globalThis.window = { addEventListener() {}, ...(globalThis.window || {}), _supabaseAuthActive: true };
    storage = requireStorage();
    calls = [];
    globalThis.isSupabaseConnected = () => true;
    globalThis.supabaseClient = {
      storage: {
        from: (bucket) => ({
          createSignedUrls: async (paths, ttl) => {
            calls.push({ bucket, paths, ttl });
            return { data: paths.map((p) => ({ path: p, signedUrl: 'https://x.supabase.co/storage/v1/object/sign/' + bucket + '/' + p + '?token=t' })), error: null };
          },
        }),
      },
    };
  });

  it('caminho: usa `path` gravado e, em anexo antigo, tira do link público', () => {
    expect(storage.attachmentStoragePath({ path: 'pendencias/P1/ATT-1-a.pdf', url: 'x' })).toBe('pendencias/P1/ATT-1-a.pdf');
    expect(storage.attachmentStoragePath({ url: 'https://x.supabase.co/storage/v1/object/public/attachments/clients/C1/DOC-1-contrato%20final.pdf' }))
      .toBe('clients/C1/DOC-1-contrato final.pdf');
    expect(storage.attachmentStoragePath({ data: 'data:image/png;base64,AA==' })).toBeNull();
    expect(storage.attachmentStoragePath({ url: 'https://outro.site/a.png' })).toBeNull();
    expect(storage.attachmentStoragePath(null)).toBeNull();
  });

  it('pede os links em lote, uma vez só (cache)', async () => {
    const a = await storage.signedStorageUrls(['pendencias/P1/a.png', 'pendencias/P1/b.png', 'pendencias/P1/a.png']);
    expect(Object.keys(a)).toHaveLength(2);
    expect(a['pendencias/P1/a.png']).toContain('/object/sign/attachments/');
    expect(calls).toHaveLength(1);
    expect(calls[0].paths).toEqual(['pendencias/P1/a.png', 'pendencias/P1/b.png']);
    const b = await storage.signedStorageUrls(['pendencias/P1/a.png']);
    expect(b['pendencias/P1/a.png']).toBe(a['pendencias/P1/a.png']);
    expect(calls).toHaveLength(1);
  });

  it('cache separado por bucket', async () => {
    await storage.signedStorageUrls(['visits/V1/f.jpg'], 'attachments');
    await storage.signedStorageUrls(['visits/V1/f.jpg'], 'outro');
    expect(calls.map((c) => c.bucket)).toEqual(['attachments', 'outro']);
  });

  it('offline: não chama o Storage e devolve vazio', async () => {
    globalThis.isSupabaseConnected = () => false;
    expect(await storage.signedStorageUrls(['clients/C1/x.pdf'])).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('erro do Storage não quebra (sem links)', async () => {
    globalThis.supabaseClient.storage.from = () => ({ createSignedUrls: async () => ({ data: null, error: { message: 'boom' } }) });
    expect(await storage.signedStorageUrls(['clients/C1/x.pdf'])).toEqual({});
  });
});
