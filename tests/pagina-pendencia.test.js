import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const { requireParts } = createRequire(import.meta.url)('./_parts.cjs');

const STATUS_FALSO = {
  backlog: { label: 'Backlog' },
  em_andamento: { label: 'Em andamento' },
};

// Compara com o relógio fixo: a faixa de "há N" não pode depender de quando o teste roda.
const AGORA = '2026-11-02T12:00:00.000Z';
const antes = (ms) => new Date(new Date(AGORA).getTime() - ms).toISOString();
const MIN = 60000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

describe('páginas de pendência', () => {
  let pagina;

  beforeEach(() => {
    globalThis.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    globalThis.STATUS_PEN_MAP = STATUS_FALSO;
    pagina = requireParts('pagina');
  });

  afterEach(() => {
    delete globalThis.STATUS_PEN_MAP;
    delete globalThis.PRIORITY_MAP;
    delete globalThis.chamadoCanalDe;
  });

  describe('penPaginaRotaDe', () => {
    it('reconhece a rota de chamado, com ou sem #', () => {
      expect(pagina.penPaginaRotaDe('#chamados/abc-1')).toEqual({ tipo: 'chamado', id: 'abc-1' });
      expect(pagina.penPaginaRotaDe('chamados/abc-1')).toEqual({ tipo: 'chamado', id: 'abc-1' });
    });
    it('reconhece a rota de projeto, com ou sem #', () => {
      expect(pagina.penPaginaRotaDe('#projetos/p_9')).toEqual({ tipo: 'projeto', id: 'p_9' });
      expect(pagina.penPaginaRotaDe('projetos/p_9')).toEqual({ tipo: 'projeto', id: 'p_9' });
    });
    it('recusa id com caractere fora do padrão: o hash vem da URL e é entrada do usuário', () => {
      expect(pagina.penPaginaRotaDe('#chamados/<img>')).toBeNull();
      expect(pagina.penPaginaRotaDe('#chamados/a/b')).toBeNull();
      expect(pagina.penPaginaRotaDe('#projetos/a b')).toBeNull();
    });
    it('recusa rota sem id', () => {
      expect(pagina.penPaginaRotaDe('#chamados/')).toBeNull();
      expect(pagina.penPaginaRotaDe('#projetos')).toBeNull();
    });
    it('recusa id maior que 128 caracteres e aceita o limite exato', () => {
      expect(pagina.penPaginaRotaDe('#chamados/' + 'a'.repeat(128))).toEqual({ tipo: 'chamado', id: 'a'.repeat(128) });
      expect(pagina.penPaginaRotaDe('#chamados/' + 'a'.repeat(129))).toBeNull();
    });
    it('hash de outra página não é rota', () => {
      expect(pagina.penPaginaRotaDe('#pendencias')).toBeNull();
      expect(pagina.penPaginaRotaDe('#clientes/abc')).toBeNull();
      expect(pagina.penPaginaRotaDe('')).toBeNull();
    });
    it('valor que não é texto devolve null em vez de quebrar', () => {
      expect(pagina.penPaginaRotaDe(null)).toBeNull();
      expect(pagina.penPaginaRotaDe(undefined)).toBeNull();
      expect(pagina.penPaginaRotaDe(42)).toBeNull();
    });
  });

  describe('penPaginaTipo', () => {
    it('canal email é chamado', () => {
      expect(pagina.penPaginaTipo({ canal: 'email' })).toBe('chamado');
    });
    it('canal whatsapp é chamado', () => {
      expect(pagina.penPaginaTipo({ canal: 'whatsapp' })).toBe('chamado');
    });
    it('canal com maiúscula continua sendo chamado', () => {
      expect(pagina.penPaginaTipo({ canal: 'Email' })).toBe('chamado');
    });
    it('sem canal, mas com canal derivado por chamadoCanalDe, é chamado', () => {
      globalThis.chamadoCanalDe = (p) => (p.solicitanteEmail ? 'email' : null);
      expect(pagina.penPaginaTipo({ solicitanteEmail: 'cliente@x.com' })).toBe('chamado');
    });
    it('sem canal e sem canal derivado é projeto interno', () => {
      globalThis.chamadoCanalDe = () => null;
      expect(pagina.penPaginaTipo({ titulo: 'Migrar servidor' })).toBe('projeto');
    });
    it('sem chamadoCanalDe carregado, item sem canal cai em projeto em vez de quebrar', () => {
      expect(pagina.penPaginaTipo({ titulo: 'Migrar servidor' })).toBe('projeto');
    });
    it('canal telefone não tem conversa para responder: é projeto', () => {
      expect(pagina.penPaginaTipo({ canal: 'telefone' })).toBe('projeto');
    });
    it('item nulo cai em projeto', () => {
      expect(pagina.penPaginaTipo(null)).toBe('projeto');
    });
  });

  describe('penPaginaHash e penPaginaHref', () => {
    it('chamado aponta para chamados/<id>', () => {
      expect(pagina.penPaginaHash({ id: 'abc', canal: 'email' })).toBe('chamados/abc');
      expect(pagina.penPaginaHref({ id: 'abc', canal: 'email' })).toBe('#chamados/abc');
    });
    it('projeto aponta para projetos/<id>', () => {
      expect(pagina.penPaginaHash({ id: 'abc' })).toBe('projetos/abc');
      expect(pagina.penPaginaHref({ id: 'abc' })).toBe('#projetos/abc');
    });
    it('id numérico vira rota válida', () => {
      expect(pagina.penPaginaHash({ id: 123 })).toBe('projetos/123');
    });
    it('id que não cabe na rota não gera hash, e o link cai na lista em vez de ficar morto', () => {
      const p = { id: '"><script>', canal: 'email' };
      expect(pagina.penPaginaHash(p)).toBe('');
      expect(pagina.penPaginaHref(p)).toBe('#pendencias');
    });
    it('item nulo não gera hash, e o link cai na lista', () => {
      expect(pagina.penPaginaHash(null)).toBe('');
      expect(pagina.penPaginaHref(null)).toBe('#pendencias');
    });
    it('o hash gerado é lido de volta pela rota com o mesmo id e tipo', () => {
      expect(pagina.penPaginaRotaDe(pagina.penPaginaHref({ id: 'x_1', canal: 'whatsapp' })))
        .toEqual({ tipo: 'chamado', id: 'x_1' });
    });
  });

  describe('pgpTempoAtras', () => {
    it('menos de um minuto é agora', () => {
      expect(pagina.pgpTempoAtras(antes(59 * 1000), AGORA)).toBe('agora');
    });
    it('data no futuro (relógio adiantado) é agora, nunca tempo negativo', () => {
      expect(pagina.pgpTempoAtras(antes(-5 * MIN), AGORA)).toBe('agora');
    });
    it('faixa de minutos', () => {
      expect(pagina.pgpTempoAtras(antes(MIN), AGORA)).toBe('há 1 min');
      expect(pagina.pgpTempoAtras(antes(59 * MIN), AGORA)).toBe('há 59 min');
    });
    it('faixa de horas', () => {
      expect(pagina.pgpTempoAtras(antes(HORA), AGORA)).toBe('há 1 h');
      expect(pagina.pgpTempoAtras(antes(23 * HORA), AGORA)).toBe('há 23 h');
    });
    it('faixa de dias, com singular e plural', () => {
      expect(pagina.pgpTempoAtras(antes(DIA), AGORA)).toBe('há 1 dia');
      expect(pagina.pgpTempoAtras(antes(29 * DIA), AGORA)).toBe('há 29 dias');
    });
    it('faixa de meses, com singular e plural', () => {
      expect(pagina.pgpTempoAtras(antes(30 * DIA), AGORA)).toBe('há 1 mês');
      expect(pagina.pgpTempoAtras(antes(90 * DIA), AGORA)).toBe('há 3 meses');
    });
    it('faixa de anos, com singular e plural', () => {
      expect(pagina.pgpTempoAtras(antes(365 * DIA), AGORA)).toBe('há 1 ano');
      expect(pagina.pgpTempoAtras(antes(800 * DIA), AGORA)).toBe('há 2 anos');
    });
    it('data ausente ou inválida devolve vazio, sem "NaN" na tela', () => {
      expect(pagina.pgpTempoAtras(null, AGORA)).toBe('');
      expect(pagina.pgpTempoAtras(undefined, AGORA)).toBe('');
      expect(pagina.pgpTempoAtras('', AGORA)).toBe('');
      expect(pagina.pgpTempoAtras('não é data', AGORA)).toBe('');
    });
  });

  describe('pgpAvatarHtml', () => {
    it('usa a inicial da primeira e da última palavra, em maiúscula', () => {
      expect(pagina.pgpAvatarHtml('ana maria souza')).toContain('>AS</span>');
    });
    it('nome de uma palavra só tem uma inicial', () => {
      expect(pagina.pgpAvatarHtml('ana')).toContain('>A</span>');
    });
    it('sem nome mostra ? e rotula como Sem nome', () => {
      const html = pagina.pgpAvatarHtml(null);
      expect(html).toContain('>?</span>');
      expect(html).toContain('aria-label="Sem nome"');
    });
    it('escapa o nome em title e aria-label', () => {
      const html = pagina.pgpAvatarHtml('"><img src=x onerror=alert(1)>');
      expect(html).not.toContain('<img');
      expect(html).toContain('title="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"');
      expect(html).toContain('aria-label="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"');
    });
    it('escapa também as iniciais, que também vêm do nome', () => {
      expect(pagina.pgpAvatarHtml('<a "b')).toContain('>&lt;&quot;</span>');
    });
    it('tamanho fora da faixa ou que não é número volta para o padrão', () => {
      expect(pagina.pgpAvatarHtml('Ana')).toContain('--pgp-avatar-size:32px');
      expect(pagina.pgpAvatarHtml('Ana', 200)).toContain('--pgp-avatar-size:32px');
      expect(pagina.pgpAvatarHtml('Ana', '1px;background:url(x)')).toContain('--pgp-avatar-size:32px');
    });
    it('tamanho válido é respeitado', () => {
      expect(pagina.pgpAvatarHtml('Ana', 48)).toContain('--pgp-avatar-size:48px');
    });
  });

  describe('pgpVoltarHtml', () => {
    it('é link real para a lista, para o histórico e a nova aba funcionarem', () => {
      expect(pagina.pgpVoltarHtml('Chamados')).toContain('<a class="pgp-voltar" href="#pendencias">');
    });
    it('sem rótulo, usa Pendências', () => {
      expect(pagina.pgpVoltarHtml()).toContain('Pendências</a>');
    });
    it('escapa o rótulo', () => {
      const html = pagina.pgpVoltarHtml('<img src=x>');
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img src=x&gt;');
    });
  });

  describe('pgpSeletoresHtml', () => {
    it('oferece as quatro prioridades, inclusive critica', () => {
      const html = pagina.pgpSeletoresHtml({ id: 'a', status: 'backlog', priority: 'alta' });
      for (const k of ['baixa', 'media', 'alta', 'critica']) {
        expect(html).toContain('<option value="' + k + '"');
      }
    });
    it('critica aparece com rótulo próprio mesmo sem PRIORITY_MAP', () => {
      const html = pagina.pgpSeletoresHtml({ id: 'a', status: 'backlog', priority: 'critica' });
      expect(html).toContain('<option value="critica" selected>Crítica</option>');
    });
    it('rótulo de PRIORITY_MAP tem precedência sobre o rótulo reserva', () => {
      globalThis.PRIORITY_MAP = { alta: { label: 'Urgente' } };
      const html = pagina.pgpSeletoresHtml({ id: 'a', status: 'backlog', priority: 'alta' });
      expect(html).toContain('<option value="alta" selected>Urgente</option>');
    });
    it('marca como selecionados o status e a prioridade atuais', () => {
      const html = pagina.pgpSeletoresHtml({ id: 'a', status: 'em_andamento', priority: 'baixa' });
      expect(html).toContain('<option value="em_andamento" selected>Em andamento</option>');
      expect(html).toContain('<option value="baixa" selected>');
    });
    it('liga os seletores às ações por delegação, sem handler inline', () => {
      const html = pagina.pgpSeletoresHtml({ id: 'a', status: 'backlog', priority: 'alta' });
      expect(html).toContain('data-change="pgpStatus"');
      expect(html).toContain('data-change="penSetField"');
      expect(html).toContain('data-field="priority"');
      expect(html).not.toMatch(/\son[a-z]+=/);
    });
    it('escapa o id nos dois seletores', () => {
      const html = pagina.pgpSeletoresHtml({ id: '"><script>', status: 'backlog', priority: 'alta' });
      expect(html).not.toContain('<script>');
      expect(html.match(/data-id="&quot;&gt;&lt;script&gt;"/g)).toHaveLength(2);
    });
    it('status fora do mapa fica visível, desabilitado e escapado', () => {
      const html = pagina.pgpSeletoresHtml({ id: 'a', status: '<b>velho', priority: 'alta' });
      expect(html).not.toContain('<b>');
      expect(html).toContain('<option value="&lt;b&gt;velho" selected disabled>&lt;b&gt;velho (antigo)</option>');
      expect(html).toContain('data-status="&lt;b&gt;velho"');
    });
    it('status legado conhecido mostra o nome legível', () => {
      const html = pagina.pgpSeletoresHtml({ id: 'a', status: 'concluido', priority: 'alta' });
      expect(html).toContain('<option value="concluido" selected disabled>Concluído (antigo)</option>');
    });
    it('prioridade fora da lista fica visível, desabilitada e escapada', () => {
      const html = pagina.pgpSeletoresHtml({ id: 'a', status: 'backlog', priority: '"x"' });
      expect(html).toContain('<option value="&quot;x&quot;" selected disabled>&quot;x&quot; (antigo)</option>');
      expect(html).toContain('data-prioridade="&quot;x&quot;"');
    });
    it('item nulo não quebra e não inventa opção de legado', () => {
      const html = pagina.pgpSeletoresHtml(null);
      expect(html).toContain('id="chgStatus"');
      expect(html).not.toContain('(antigo)');
    });
  });

  describe('abrirPaginaPendencia e a volta da ficha do cliente', () => {
    let chamadas;

    beforeEach(() => {
      chamadas = { rota: [], modal: [] };
      // A ficha do cliente define as duas variáveis no mesmo escopo global de script;
      // aqui elas entram como globais para reproduzir o consumo dentro de closeModal.
      globalThis._clientPenReturn = { clientId: 'CLI-1' };
      globalThis._clientPenOrigin = { clientId: 'CLI-1', penId: 'PEN-1' };
      globalThis.openPendenciaDetailModal = (id) => chamadas.modal.push(id);
      globalThis.navigateTo = (hash) => chamadas.rota.push(hash);
      globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
      globalThis.window = { location: { hash: '', replace() {} }, scrollY: 0, scrollTo() {} };
    });

    afterEach(() => {
      delete globalThis._clientPenReturn;
      delete globalThis._clientPenOrigin;
      delete globalThis.openPendenciaDetailModal;
      delete globalThis.navigateTo;
      delete globalThis.document;
      delete globalThis.window;
    });

    it('id válido vira rota e limpa o retorno à ficha, que cobriria a página', () => {
      pagina.abrirPaginaPendencia('PEN-1');
      expect(chamadas.rota).toEqual(['projetos/PEN-1']);
      expect(globalThis._clientPenReturn).toBeNull();
      expect(globalThis._clientPenOrigin).toBeNull();
    });

    it('id fora do padrão mantém o retorno para o modal antigo devolver à ficha', () => {
      pagina.abrirPaginaPendencia('PEN 1');
      expect(chamadas.modal).toEqual(['PEN 1']);
      expect(globalThis._clientPenReturn).toEqual({ clientId: 'CLI-1' });
      expect(globalThis._clientPenOrigin).toEqual({ clientId: 'CLI-1', penId: 'PEN-1' });
    });
  });

  describe('navigateTo em rota de item', () => {
    // app.js depende do DOM inteiro; o stub cobre só o caminho da rota de item.
    function navegar() {
      const chamadas = { render: [], atualizar: [] };
      let aberta = null;
      const sb = {
        console,
        document: {
          querySelectorAll: () => [],
          getElementById: (id) => {
            if (id === 'topbarActionBtn' || id === 'loginOverlay' || id === 'loginContent') return { style: {} };
            return null;
          },
        },
        window: { location: { hash: '#chamados/PEN-1' }, scrollY: 0, scrollTo() {} },
        requestAnimationFrame: () => {},
        setTimeout: () => 0,
        clearTimeout: () => {},
        updateBadges: () => {},
        // init() roda ao carregar app.js: sem Supabase ele só monta a tela de login.
        isSupabaseConnected: () => false,
        seedDemoData: () => {},
        penPaginaRotaDe: (h) => (h === 'chamados/PEN-1' ? { tipo: 'chamado', id: 'PEN-1' } : null),
        penPaginaEstaAberta: (id) => aberta === id,
        penPaginaFechar: () => {},
        penPaginaAtualizar: (id) => chamadas.atualizar.push(id),
        renderPaginaPendencia: (tipo, id) => {
          chamadas.render.push([tipo, id]);
          aberta = id;
        },
      };
      sb.globalThis = sb;
      vm.createContext(sb);
      vm.runInContext(fs.readFileSync('js/app.js', 'utf8'), sb, { filename: 'js/app.js' });
      // app.js declara updateBadges e ele depende de sessão/cache; o caminho testado não precisa.
      sb.updateBadges = () => {};
      return { sb, chamadas };
    }

    it('recarregar a mesma rota atualiza sem recriar o DOM, para o rascunho sobreviver', () => {
      const { sb, chamadas } = navegar();
      sb.navigateTo('chamados/PEN-1');
      sb.navigateTo('chamados/PEN-1');
      expect(chamadas.render).toEqual([['chamado', 'PEN-1']]);
      expect(chamadas.atualizar).toEqual(['PEN-1']);
    });
  });
});
