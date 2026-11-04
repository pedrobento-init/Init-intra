import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// js/ é modo script: as funções viram propriedades do contexto. js/ui.js não
// carrega fora do navegador, então os utilitários dele entram como stub que
// escapa tudo, o que torna as asserções de XSS mais estritas, nunca mais frouxas.
const _escape = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const ARQUIVOS = [
  'js/chamado-detalhe.js',
  'js/chamado-canal.js',
  'js/sla.js',
  'js/pagina-pendencia.js',
  'js/pendencias-detalhe.js',
  'js/pendencias-acoes.js',
  'js/chamado-pagina.js',
];

const AGORA = new Date('2026-10-30T15:00:00.000Z').getTime();
const antes = (min) => new Date(AGORA - min * 60000).toISOString();

const XSS = '<img src=x onerror=alert(1)>';

function criarSandbox() {
  const els = {};
  const acoes = {};
  const sb = {
    console,
    els,
    acoes,
    anexos: [],
    Date,
    escapeHtml: _escape,
    renderRichText: _escape,
    renderRichNoteText: _escape,
    highlightMentions: (s) => s,
    safeUrl: (u) => (/^(https?:|mailto:)/i.test(String(u)) ? String(u) : '#'),
    document: {
      getElementById: (id) => els[id] || null,
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    location: { origin: 'https://exemplo.test', pathname: '/', hash: '' },
    getUser: () => ({ name: 'Ana Atendente' }),
    getOperators: () => [],
    getPendenciaById: () => null,
    getClients: () => [],
    getClientById: () => null,
    addPendenciaNote: () => true,
    showToast: () => {},
    openPendenciaDetail: () => {},
    changePenStatus: () => {},
    penDisplayNumber: (p) => '#' + (p.numero || 7),
    getCurrentWorker: () => null,
    isCurrentWorker: () => false,
    timerDisplayHTML: () => '',
    getElapsedSeconds: () => 0,
    getAttachments: () => sb.anexos,
    registerActions: (mapa) => Object.assign(acoes, mapa),
  };
  sb.globalThis = sb;
  sb.window = sb;
  sb.addEventListener = () => {};
  sb.debounce = (fn) => fn;
  sb.renderPenView = () => {};
  vm.createContext(sb);
  for (const arq of ARQUIVOS) {
    vm.runInContext(fs.readFileSync(arq, 'utf8'), sb, { filename: arq });
  }
  return sb;
}

function chamado(extra) {
  return {
    id: 'p1',
    numero: 7,
    title: 'Impressora parada',
    descricao: 'Corpo original do e-mail',
    status: 'aberta',
    priority: 'media',
    team: 'init',
    createdAt: antes(600),
    solicitante: 'Bia Cliente',
    solicitanteEmail: 'bia@cliente.com',
    notes: [],
    events: [],
    ...extra,
  };
}

function desenhar(sb, p, estado) {
  const container = { innerHTML: '' };
  sb.renderChamadoPagina(p, container, estado == null ? null : estado);
  return container.innerHTML;
}

// As bolhas saem na ordem do fio; o atributo identifica o tipo sem depender de CSS.
function tiposDasBolhas(html) {
  return [...html.matchAll(/data-chp-tipo="([a-z]+)"/g)].map((m) => m[1]);
}

describe('chamado-pagina', () => {
  let sb;
  beforeEach(() => {
    sb = criarSandbox();
  });

  describe('escape de dado de usuário', () => {
    it('escapa o corpo do e-mail original', () => {
      const html = desenhar(sb, chamado({ descricao: XSS }));
      expect(html).not.toContain(XSS);
      expect(html).toContain('&lt;img src=x');
    });

    it('escapa o corpo vindo de emailCorpo', () => {
      const html = desenhar(sb, chamado({ descricao: '', emailCorpo: XSS }));
      expect(html).not.toContain(XSS);
      expect(html).toContain('&lt;img src=x');
    });

    it('escapa o nome de quem pediu', () => {
      const html = desenhar(sb, chamado({ solicitante: XSS }));
      expect(html).not.toContain(XSS);
      expect(html).toContain('&lt;img src=x');
    });

    it('escapa o e-mail de quem pediu, também no mailto', () => {
      const html = desenhar(sb, chamado({ solicitanteEmail: '"><script>x</script>@a.com' }));
      expect(html).not.toContain('<script>x');
      expect(html).not.toContain('"><script');
    });

    it('escapa o texto de uma nota', () => {
      const p = chamado({
        notes: [{ text: XSS, author: 'Ana Atendente', createdAt: antes(30), visibility: 'interna' }],
      });
      const html = desenhar(sb, p);
      expect(html).not.toContain(XSS);
      expect(html).toContain('&lt;img src=x');
    });

    it('escapa o autor de uma nota', () => {
      const p = chamado({
        notes: [{ text: 'oi', author: XSS, createdAt: antes(30), visibility: 'interna' }],
      });
      expect(desenhar(sb, p)).not.toContain(XSS);
    });

    it('escapa o nome do anexo', () => {
      sb.anexos = [{ id: 'a1', name: XSS, url: 'https://x.test/a.pdf', uploadedAt: antes(120), uploadedBy: 'Ana' }];
      const html = desenhar(sb, chamado());
      expect(html).not.toContain(XSS);
      expect(html).toContain('&lt;img src=x');
    });

    it('não vira link o anexo com URL insegura', () => {
      sb.anexos = [{ id: 'a1', name: 'mau.html', url: 'javascript:alert(1)', uploadedAt: antes(120), uploadedBy: 'Ana' }];
      const html = desenhar(sb, chamado());
      expect(html).not.toContain('javascript:alert');
      expect(html).toContain('chp-anexo--off');
    });

    it('PDF em data: vira download, nunca navegação', () => {
      sb.anexos = [{ id: 'a1', name: 'contrato.pdf', mimeType: 'application/pdf', data: 'data:application/pdf;base64,AAA', uploadedAt: antes(120), uploadedBy: 'Ana' }];
      const html = desenhar(sb, chamado());
      expect(html).toMatch(/<a class="chp-anexo" href="data:application\/pdf;base64,AAA" download="contrato.pdf">/);
      expect(html).not.toContain('target="_blank"');
      expect(html).not.toContain('chp-anexo--off');
    });

    it('data:text/html não vira link nem src', () => {
      sb.anexos = [{ id: 'a1', name: 'mau.html', mimeType: 'text/html', data: 'data:text/html,<script>alert(1)</script>', uploadedAt: antes(120), uploadedBy: 'Ana' }];
      const html = desenhar(sb, chamado());
      expect(html).not.toContain('data:text/html');
      expect(html).not.toContain('href="data:');
      expect(html).toContain('chp-anexo--off');
    });
  });

  describe('mudança automática de status (078)', () => {
    const automatico = (motivo) => ({ at: antes(60), by: 'Sistema', type: 'status', de: 'aguardando_cliente', para: 'em_andamento', motivo });

    it('o Andamento diz por que o status mudou sozinho', () => {
      const itens = sb.chpAndamento(chamado({ events: [automatico('Cliente respondeu')] }));
      expect(itens.find((i) => i.titulo.indexOf('Status') === 0)).toMatchObject({ autor: 'Sistema · Cliente respondeu' });
    });

    it('evento feito por gente continua mostrando só quem fez', () => {
      const itens = sb.chpAndamento(chamado({ events: [{ at: antes(60), by: 'Ana', type: 'status', de: 'aberto', para: 'em_andamento' }] }));
      expect(itens.find((i) => i.titulo.indexOf('Status') === 0).autor).toBe('Ana');
    });

    it('escapa o motivo no Andamento e no fio do detalhe', () => {
      const p = chamado({ events: [automatico(XSS)] });
      expect(desenhar(sb, p)).not.toContain(XSS);
      sb.formatDateTime = (iso) => String(iso);
      const ev = sb._penFeedItens(p).find((i) => i._evento);
      const html = sb._penEventoHtml(ev);
      expect(html).not.toContain(XSS);
      expect(html).toContain('&lt;img src=x');
    });
  });

  describe('Recebido e Visto no Andamento', () => {
    const titulos = (p) => sb.chpAndamento(p).map((i) => i.titulo);
    const item = (p, titulo) => sb.chpAndamento(p).find((i) => i.titulo === titulo);
    const troca = (min, de, para) => ({ at: antes(min), by: 'Gestor', type: 'responsavel', de, para });

    it('aberto já com responsável: Recebido no instante da abertura, logo depois de Aberto', () => {
      const p = chamado({ responsible: 'Ana', events: [{ at: antes(600), by: '', type: 'criado', de: null, para: 'aberto' }], createdAt: antes(600) });
      expect(titulos(p)).toEqual(['Chamado aberto', 'Recebido']);
      expect(item(p, 'Recebido')).toMatchObject({ autor: 'Ana', at: antes(600) });
    });

    it('atribuído depois: Recebido na hora da atribuição, sem repetir como "Passou para"', () => {
      const p = chamado({ responsible: 'Ana', events: [troca(300, null, 'Ana')] });
      expect(item(p, 'Recebido')).toMatchObject({ autor: 'Ana', at: antes(300) });
      expect(titulos(p).some((t) => t.indexOf('Passou para') === 0)).toBe(false);
    });

    it('transferências depois da chegada continuam como "Passou para"', () => {
      const p = chamado({ responsible: 'Beto', events: [troca(300, '', 'Ana'), troca(100, 'Ana', 'Beto')] });
      expect(item(p, 'Recebido').autor).toBe('Ana');
      expect(titulos(p)).toContain('Passou para Beto');
    });

    it('aberto com Ana e transferido: quem recebeu foi Ana, na abertura', () => {
      const p = chamado({ responsible: 'Beto', events: [troca(100, 'Ana', 'Beto')] });
      expect(item(p, 'Recebido')).toMatchObject({ autor: 'Ana', at: antes(600) });
    });

    it('sem responsável ainda não tem Recebido', () => {
      expect(titulos(chamado({ responsible: '' }))).not.toContain('Recebido');
    });

    it('Visto mostra quem viu, em ordem com o resto', () => {
      const p = chamado({ responsible: 'Ana', events: [{ at: antes(200), by: 'Ana', by_id: 'OP-A', type: 'visto' }] });
      expect(titulos(p)).toEqual(['Chamado aberto', 'Recebido', 'Visto']);
      expect(item(p, 'Visto').autor).toBe('Ana');
    });

    it('Visto não entra na conversa: é marco do Andamento', () => {
      const p = chamado({ responsible: 'Ana', events: [{ at: antes(200), by: 'Ana', type: 'visto' }] });
      expect(desenhar(sb, p)).not.toContain('visualizou');
    });

    it('escapa o nome de quem recebeu e de quem viu', () => {
      const p = chamado({ responsible: XSS, events: [{ at: antes(200), by: XSS, type: 'visto' }] });
      const html = desenhar(sb, p);
      expect(html).not.toContain(XSS);
      expect(html).toContain('&lt;img src=x');
    });
  });

  describe('marcar Visto ao abrir', () => {
    let chamadas;
    let cache;
    let resposta;

    beforeEach(() => {
      chamadas = [];
      cache = [chamado({ id: 'p1', responsible: 'Ana Atendente', status: 'aberto' })];
      resposta = { data: { events: [{ at: '2026-10-30T15:00:00.000Z', by: 'Ana Atendente', by_id: 'OP-A', type: 'visto' }], updated_at: '2026-10-30T15:00:00Z' }, error: null };
      sb.supabaseClient = { rpc: (nome, args) => { chamadas.push([nome, args]); return Promise.resolve(resposta); } };
      sb.isSupabaseConnected = () => true;
      sb._supabaseAuthActive = true;
      sb.getPendencias = () => cache;
      sb.DB = { PENDENCIAS: 'pendencias' };
      sb.dbSet = (_k, lista) => { cache = lista; };
      sb.isPendenciaClosed = (st) => ['resolvido', 'cancelado', 'concluido', 'fechado'].includes(st);
    });

    it('precisa marcar só quando o usuário é o responsável, o chamado está aberto e ainda não viu', () => {
      const p = chamado({ responsible: 'Ana', status: 'aberto' });
      expect(sb.chpPrecisaMarcarVisto(p, 'Ana')).toBe(true);
      expect(sb.chpPrecisaMarcarVisto(p, 'Beto')).toBe(false);
      expect(sb.chpPrecisaMarcarVisto({ ...p, status: 'resolvido' }, 'Ana')).toBe(false);
      expect(sb.chpPrecisaMarcarVisto({ ...p, events: [{ type: 'visto', by: 'Ana' }] }, 'Ana')).toBe(false);
    });

    it('chama o banco uma vez por sessão e soma o evento no cache', async () => {
      await sb.chpMarcarVisto(cache[0]);
      expect(chamadas).toEqual([['marcar_chamado_visto', { p_id: 'p1' }]]);
      expect(cache[0].events.map((e) => e.type)).toEqual(['visto']);
      // Redesenho com o cache ainda sem o evento (sync atrasado) não chama de novo.
      expect(sb.chpMarcarVisto({ ...cache[0], events: [] })).toBeNull();
      expect(chamadas).toHaveLength(1);
    });

    it('quem só olha o chamado de outro não chama o banco', () => {
      cache[0].responsible = 'Beto';
      expect(sb.chpMarcarVisto(cache[0])).toBeNull();
      expect(chamadas).toEqual([]);
    });

    it('offline não chama o banco', () => {
      sb.isSupabaseConnected = () => false;
      expect(sb.chpMarcarVisto(cache[0])).toBeNull();
      expect(chamadas).toEqual([]);
    });

    it('banco sem a 079 (erro) não quebra nem mexe no cache', async () => {
      resposta = { data: null, error: { message: 'function marcar_chamado_visto does not exist' } };
      await sb.chpMarcarVisto(cache[0]);
      expect(cache[0].events).toEqual([]);
    });

    it('banco disse que não gravou (null): o cache fica como está', async () => {
      resposta = { data: null, error: null };
      await sb.chpMarcarVisto(cache[0]);
      expect(cache[0].events).toEqual([]);
    });
  });

  describe('fio da conversa', () => {
    it('tem a mensagem original como primeira bolha', () => {
      const p = chamado({
        notes: [{ text: 'mais antiga que tudo', author: 'Ana', createdAt: antes(900), visibility: 'interna' }],
      });
      expect(tiposDasBolhas(desenhar(sb, p))[0]).toBe('original');
    });

    it('marca a mensagem original como vinda de quem pediu', () => {
      const html = desenhar(sb, chamado());
      expect(html).toMatch(/chp-msg--solicitante[^>]*data-chp-tipo="original"/);
    });

    it('põe a resposta da equipe no lado da equipe', () => {
      const p = chamado({
        notes: [{ text: 'Respondi', author: 'Ana', createdAt: antes(30), visibility: 'resposta' }],
      });
      expect(desenhar(sb, p)).toMatch(/chp-msg--equipe[^>]*data-chp-tipo="resposta"/);
    });

    it('põe a mensagem de quem pediu no lado de quem pediu', () => {
      const p = chamado({
        notes: [{ text: 'Voltou a falhar', author: 'Bia', createdAt: antes(30), visibility: 'solicitante' }],
      });
      expect(desenhar(sb, p)).toMatch(/chp-msg--solicitante[^>]*data-chp-tipo="solicitante"/);
    });

    it('destaca a nota interna e avisa que só a equipe vê', () => {
      const p = chamado({
        notes: [{ text: 'Só nós', author: 'Ana', createdAt: antes(30), visibility: 'interna' }],
      });
      const html = desenhar(sb, p);
      expect(html).toMatch(/chp-msg--nota[^>]*data-chp-tipo="interna"/);
      expect(html).toContain('anotação interna, só a equipe vê');
    });

    it('trata nota sem visibility como interna', () => {
      const p = chamado({ notes: [{ text: 'antiga', author: 'Ana', createdAt: antes(30) }] });
      expect(tiposDasBolhas(desenhar(sb, p))).toContain('interna');
    });

    it('trata a nota do cronômetro com ⏹ como sistema, como ▶ e ⏸', () => {
      expect(sb.chpTipoNota({ text: '⏹ Cronômetro de Ana parado ao concluir.' })).toBe('sistema');
      expect(sb.chpTipoNota({ text: '⏸ Ana pausou.' })).toBe('sistema');
      expect(sb.chpTipoNota({ text: '▶ Ana iniciou.' })).toBe('sistema');
    });

    it('não deixa o ⏹ aparecer no fio como anotação interna', () => {
      const p = chamado({ notes: [{ text: '⏹ Cronômetro de Ana parado.', author: 'Ana', createdAt: antes(30) }] });
      const html = desenhar(sb, p);
      expect(html).not.toContain('⏹');
      expect(html).toContain('Cronômetro de Ana parado.');
    });

    it('ordena as notas por data, não pela ordem do array', () => {
      const p = chamado({
        notes: [
          { text: 'SEGUNDA', author: 'Ana', createdAt: antes(10), visibility: 'interna' },
          { text: 'PRIMEIRA', author: 'Ana', createdAt: antes(50), visibility: 'interna' },
        ],
      });
      const html = desenhar(sb, p);
      expect(html.indexOf('PRIMEIRA')).toBeLessThan(html.indexOf('SEGUNDA'));
    });

    it('coloca divisor quando a data muda e não repete no mesmo dia', () => {
      const p = chamado({
        createdAt: '2026-10-28T12:00:00.000Z',
        notes: [
          { text: 'a', author: 'Ana', createdAt: '2026-10-28T13:00:00.000Z', visibility: 'interna' },
          { text: 'b', author: 'Ana', createdAt: '2026-10-29T13:00:00.000Z', visibility: 'interna' },
          { text: 'c', author: 'Ana', createdAt: '2026-10-29T14:00:00.000Z', visibility: 'interna' },
        ],
      });
      const divisores = desenhar(sb, p).match(/class="chp-dia"/g) || [];
      expect(divisores.length).toBe(2);
    });

    it('mostra transferência como evento central e omite o evento de criação', () => {
      const p = chamado({
        events: [
          { at: antes(600), by: 'Sistema', type: 'criado' },
          { at: antes(20), by: 'Ana', type: 'transferencia', de: 'Ana', para: 'Caio' },
        ],
      });
      const itens = sb.chpItensConversa(p, []);
      const eventos = Array.from(itens).filter((i) => i.tipo === 'evento');
      expect(eventos.length).toBe(1);
      expect(eventos[0].evento.type).toBe('transferencia');
    });

    it('não quebra sem notes e sem events', () => {
      const p = chamado();
      delete p.notes;
      delete p.events;
      expect(tiposDasBolhas(desenhar(sb, p))).toEqual(['original']);
    });
  });

  describe('composer e canal', () => {
    const SEM_CONTATO = { solicitanteEmail: '' };

    it('sem contato avisa e desabilita Responder', () => {
      const html = desenhar(sb, chamado(SEM_CONTATO));
      expect(html).toContain('Sem e-mail nem WhatsApp de quem pediu');
      expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*(<[^>]+>[^<]*)*Responder/);
    });

    it('sem contato abre em anotação interna e não renderiza a caixa de resposta', () => {
      const p = chamado(SEM_CONTATO);
      expect(sb.chpModoInicial(p, null)).toBe('nota');
      const html = desenhar(sb, p);
      expect(html).not.toContain('id="newNoteText"');
      expect(html).toContain('id="chamadoNotaTexto"');
    });

    it('com e-mail, a ajuda cita o endereço real', () => {
      expect(desenhar(sb, chamado())).toContain('Vai por e-mail para');
      expect(desenhar(sb, chamado())).toContain('bia@cliente.com');
    });

    it('não usa respostas prontas, Cancelar nem Assunto no composer', () => {
      const composer = sb.chpComposerHtml(chamado(), 'resposta');
      expect(composer).not.toMatch(/respostas? prontas?/i);
      expect(composer).not.toContain('Cancelar');
      expect(composer).not.toContain('Assunto');
    });

    it('avisa que o anexo fica só no chamado', () => {
      expect(sb.chpComposerHtml(chamado(), 'resposta')).toContain('Anexo fica só no chamado');
    });
  });

  describe('canal WhatsApp', () => {
    // A thread "whatsapp:" é o que chamado-canal.js usa para definir o canal,
    // mesmo com e-mail preenchido: a ajuda tem de seguir o canal real.
    const whatsapp = () => chamado({ emailThreadId: 'whatsapp:5511999990000', solicitanteEmail: 'bia@cliente.com' });

    it('mostra na ajuda que a resposta vai por WhatsApp', () => {
      const composer = sb.chpComposerHtml(whatsapp(), 'resposta');
      expect(composer).toContain('Vai por WhatsApp para');
      expect(composer).not.toContain('Vai por e-mail');
    });
  });

  describe('selos de prazo', () => {
    it('cumprido quando respondeu no prazo', () => {
      expect(sb.chpSeloPrazo({ estado: 'respondida', noPrazo: true, minutos: 3 }).rotulo).toBe('Cumprido');
    });

    it('cumprido quando resolveu no prazo', () => {
      expect(sb.chpSeloPrazo({ estado: 'resolvida', noPrazo: true, minutos: 3 }).rotulo).toBe('Cumprido');
    });

    it('atrasado quando respondeu fora do prazo', () => {
      expect(sb.chpSeloPrazo({ estado: 'respondida', noPrazo: false, minutos: 3 }).rotulo).toBe('Atrasado');
    });

    it('atrasado quando a resposta está vencida', () => {
      expect(sb.chpSeloPrazo({ estado: 'atrasada', minutos: 3 }).rotulo).toBe('Atrasado');
    });

    it('atrasado quando a resolução estourou', () => {
      expect(sb.chpSeloPrazo({ estado: 'estourada', minutos: 3 }).rotulo).toBe('Atrasado');
    });

    it('sem meta quando não há SLA', () => {
      expect(sb.chpSeloPrazo({ estado: 'sem_sla' }).rotulo).toBe('Sem meta');
    });

    it('não chama de cumprido a meta ainda em aberto', () => {
      expect(sb.chpSeloPrazo({ estado: 'no_prazo', minutos: 40 }).rotulo).toBe('No prazo');
      expect(sb.chpSeloPrazo({ estado: 'vence_logo', minutos: 4 }).rotulo).toBe('No prazo');
    });
  });

  describe('redesenho', () => {
    it('mantém o modo de anotação vindo do estado', () => {
      expect(sb.chpModoInicial(chamado(), { modo: 'nota' })).toBe('nota');
    });

    it('volta a Responder quando não há estado', () => {
      expect(sb.chpModoInicial(chamado(), null)).toBe('resposta');
    });

    it('expõe os rascunhos às chaves que a base captura e restaura', () => {
      const html = desenhar(sb, chamado());
      expect(html).toContain('data-pgp-rascunho="chp-resposta"');
      expect(html).toContain('data-pgp-rascunho="chp-nota"');
    });

    it('marca o modo atual para a base capturar antes do próximo desenho', () => {
      const html = desenhar(sb, chamado(), { modo: 'nota', rascunhos: {}, scrollY: 0, foco: null });
      expect(html).toMatch(/data-pgp-modo="nota"/);
    });

    it('deixa o painel de transferir fechado sem rascunho', () => {
      expect(desenhar(sb, chamado())).toMatch(/id="chpPainelTransferir" hidden/);
    });

    it('reabre o painel de transferir que tinha rascunho', () => {
      const html = desenhar(sb, chamado(), {
        modo: 'resposta',
        rascunhos: { 'chp-transfer-motivo': 'passando para o Caio' },
        scrollY: 0,
        foco: null,
      });
      expect(html).toContain('id="chpPainelTransferir"');
      expect(html).not.toMatch(/id="chpPainelTransferir" hidden/);
    });
  });

  describe('posição do anexo', () => {
    const nota = (extra) => ({ text: 'x', author: 'Ana', createdAt: antes(60), visibility: 'interna', ...extra });

    it('sem data válida fica no topo, sem atribuir a quem pediu', () => {
      const pos = sb.chpPosicaoAnexo({ name: 'a.pdf', uploadedBy: 'Ana' }, chamado(), [nota()]);
      expect(pos.onde).toBe('topo');
    });

    it('com data inválida também fica no topo', () => {
      const pos = sb.chpPosicaoAnexo({ name: 'a.pdf', uploadedAt: 'ontem', uploadedBy: 'Ana' }, chamado(), []);
      expect(pos.onde).toBe('topo');
    });

    it('mesmo autor e até 5 minutos entra na bolha da nota', () => {
      const n = nota();
      const pos = sb.chpPosicaoAnexo({ name: 'a.pdf', uploadedAt: antes(56), uploadedBy: 'Ana' }, chamado(), [n]);
      expect(pos.onde).toBe('nota');
      expect(pos.nota).toBe(n);
    });

    it('mesmo autor e passou de 5 minutos não entra na bolha', () => {
      const pos = sb.chpPosicaoAnexo({ name: 'a.pdf', uploadedAt: antes(54), uploadedBy: 'Ana' }, chamado(), [nota()]);
      expect(pos.onde).toBe('evento');
    });

    it('autor diferente não entra na bolha, mesmo no mesmo minuto', () => {
      const pos = sb.chpPosicaoAnexo({ name: 'a.pdf', uploadedAt: antes(60), uploadedBy: 'Caio' }, chamado(), [nota()]);
      expect(pos.onde).toBe('evento');
    });

    it('escolhe a nota mais próxima quando duas se qualificam', () => {
      const longe = nota({ createdAt: antes(64) });
      const perto = nota({ createdAt: antes(61) });
      const pos = sb.chpPosicaoAnexo({ name: 'a.pdf', uploadedAt: antes(60), uploadedBy: 'Ana' }, chamado(), [longe, perto]);
      expect(pos.nota).toBe(perto);
    });

    it('até 5 minutos da criação do chamado entra na primeira bolha', () => {
      const p = chamado();
      const pos = sb.chpPosicaoAnexo({ name: 'a.pdf', uploadedAt: antes(598), uploadedBy: 'Caio' }, p, []);
      expect(pos.onde).toBe('original');
    });

    it('fora de todas as janelas vira evento central', () => {
      const pos = sb.chpPosicaoAnexo({ name: 'a.pdf', uploadedAt: antes(300), uploadedBy: 'Caio' }, chamado(), []);
      expect(pos.onde).toBe('evento');
    });

    it('avisa que o anexo em bolha de resposta não foi a quem pediu', () => {
      const p = chamado({
        notes: [{ text: 'Segue', author: 'Ana', createdAt: antes(60), visibility: 'resposta' }],
      });
      sb.anexos = [{ id: 'a1', name: 'a.pdf', url: 'https://x.test/a.pdf', uploadedAt: antes(59), uploadedBy: 'Ana' }];
      expect(desenhar(sb, p)).toContain('Não foi enviado a quem pediu');
    });
  });
});
