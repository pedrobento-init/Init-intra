import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// js/whatsapp-automacao.js é script clássico. O que se trava aqui é o que a
// pessoa digita virar a configuração certa (ou um erro claro), e a nota no
// painel sair escapada — operador e telefone vêm do banco.

let ui;
beforeEach(() => {
  globalThis.escapeHtml = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  globalThis.formatDateTime = (iso) => 'em ' + iso.slice(0, 10);
  globalThis.isSupabaseConnected = () => false;
  delete require.cache[require.resolve('../js/whatsapp-automacao.js')];
  ui = require('../js/whatsapp-automacao.js');
});

describe('wautoFaixasDoTexto', () => {
  it('lê faixas em vários formatos', () => {
    expect(ui.wautoFaixasDoTexto('08:30-12:00, 13:00-17:30').faixas).toEqual([
      ['08:30', '12:00'],
      ['13:00', '17:30'],
    ]);
    expect(ui.wautoFaixasDoTexto('8h-12h; 13h30 às 18h').faixas).toEqual([
      ['08:00', '12:00'],
      ['13:30', '18:00'],
    ]);
  });

  it('vazio é dia fechado; faixa que vira o dia é aceita', () => {
    expect(ui.wautoFaixasDoTexto('  ')).toEqual({ faixas: [], erro: null });
    expect(ui.wautoFaixasDoTexto('22:00-02:00').faixas).toEqual([['22:00', '02:00']]);
  });

  it.each(['8-8', '25:00-26:00', '08:30', 'manhã', '24:00-02:00'])('recusa "%s"', (t) => {
    expect(ui.wautoFaixasDoTexto(t).erro).toBeTruthy();
  });

  it('ida e volta com o texto do formulário', () => {
    const faixas = [
      ['08:30', '12:00'],
      ['13:00', '17:30'],
    ];
    expect(ui.wautoFaixasDoTexto(ui.wautoFaixasParaTexto(faixas)).faixas).toEqual(faixas);
  });
});

describe('wautoFeriadosDoTexto', () => {
  it('25/12 vale todo ano; com ano, só aquele dia', () => {
    expect(ui.wautoFeriadosDoTexto('25/12\n20/11/2026, 2027-01-01').feriados).toEqual([
      '12-25',
      '2026-11-20',
      '2027-01-01',
    ]);
  });

  it('recusa o que não é data', () => {
    expect(ui.wautoFeriadosDoTexto('natal').erro).toBeTruthy();
    expect(ui.wautoFeriadosDoTexto('32/12').erro).toBeTruthy();
  });

  it('volta para o formato que a pessoa digitou', () => {
    expect(ui.wautoFeriadosParaTexto(['12-25', '2026-11-20'])).toBe('25/12\n20/11/2026');
  });
});

describe('wautoLinhaDoFormulario', () => {
  const base = { dia_1: '08:00-18:00' };

  it('tudo desmarcado sai desligado, com texto vazio = null (o servidor usa o padrão)', () => {
    const { linha, erro } = ui.wautoLinhaDoFormulario(base, 'mam', 'Ana');
    expect(erro).toBeUndefined();
    expect(linha).toMatchObject({
      team: 'mam',
      horario_ativo: false,
      saudacao_ativa: false,
      encerramento_ativo: false,
      pesquisa_ativa: false,
      inatividade_ativa: false,
      texto_saudacao: null,
      horario: { 1: [['08:00', '18:00']] },
      updated_by: 'Ana',
    });
  });

  it('dia com faixa inválida diz qual dia corrigir', () => {
    expect(ui.wautoLinhaDoFormulario({ dia_3: 'manhã' }, 'init').erro).toMatch(/^Quarta:/);
  });

  it('horário ligado sem nenhum dia é erro, não "sempre fechado" por engano', () => {
    expect(ui.wautoLinhaDoFormulario({ horario_ativo: true }, 'init').erro).toBeTruthy();
  });

  it('inatividade ligada exige prazo de encerrar, e lembrete antes dele', () => {
    expect(ui.wautoLinhaDoFormulario({ inatividade_ativa: true }, 'init').erro).toBeTruthy();
    expect(
      ui.wautoLinhaDoFormulario(
        { inatividade_ativa: true, inatividade_lembrete_min: '60', inatividade_encerrar_min: '30' },
        'init'
      ).erro
    ).toMatch(/antes do encerramento/);
    const ok = ui.wautoLinhaDoFormulario(
      { inatividade_ativa: true, inatividade_lembrete_min: '20', inatividade_encerrar_min: '60' },
      'init'
    );
    expect(ok.linha).toMatchObject({ inatividade_lembrete_min: 20, inatividade_encerrar_min: 60 });
  });

  it('texto acima de 1000 caracteres é recusado', () => {
    expect(
      ui.wautoLinhaDoFormulario({ texto_saudacao: 'x'.repeat(1001) }, 'init').erro
    ).toBeTruthy();
  });
});

describe('nota no painel da conversa', () => {
  it('mostra estrelas, nota e média; operador sai escapado', () => {
    const html = ui.wautoAvaliacoesHTML([
      { nota: 4, operador: '<img src=x onerror=alert(1)>', respondida_em: '2026-11-18T13:00:00Z' },
      { nota: 5, operador: 'Ana', respondida_em: '2026-11-01T13:00:00Z' },
    ]);
    expect(html).toContain('★★★★☆');
    expect(html).toContain('4/5');
    expect(html).toContain('4,5/5');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('sem avaliação a seção não aparece', () => {
    expect(ui.wautoAvaliacoesHTML([])).toBe('');
    expect(ui.wautoAvaliacaoHTML({ canal: 'email', telefone: '' })).toBe('');
  });

  it('busca de novo quando chegou mensagem depois da última leitura, com piso de 15 s', () => {
    const agora = Date.parse('2026-11-18T13:10:00Z');
    const cache = { em: agora - 60_000, lista: [] };
    expect(ui._wautoPrecisaBuscar(null, '', agora)).toBe(true);
    expect(ui._wautoPrecisaBuscar(cache, '2026-11-18T13:09:30Z', agora)).toBe(true);
    expect(ui._wautoPrecisaBuscar(cache, '2026-11-18T13:08:00Z', agora)).toBe(false);
    expect(ui._wautoPrecisaBuscar({ em: agora - 5000 }, '2026-11-18T13:09:59Z', agora)).toBe(false);
    // Tabela ausente (088 não aplicada): não insiste a cada redesenho.
    expect(ui._wautoPrecisaBuscar({ em: agora - 60_000, erro: true }, 'z', agora)).toBe(false);
  });
});

describe('acesso', () => {
  it('botão da configuração só para admin', () => {
    globalThis.isCurrentAdmin = () => false;
    expect(ui.wautoBotaoCaixaHTML()).toBe('');
    globalThis.isCurrentAdmin = () => true;
    expect(ui.wautoBotaoCaixaHTML()).toContain('data-action="wautoAbrir"');
    delete globalThis.isCurrentAdmin;
  });

  it('offline o encerramento não chama o servidor', () => {
    expect(ui.wautoAvisarEncerramento({ canal: 'whatsapp', telefone: '5511' })).toBeNull();
  });

  it('o formulário escapa o texto salvo e não usa handler inline', () => {
    const html = ui.wautoFormHTML('init', { texto_saudacao: '"><script>x</script>' });
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/\son[a-z]+=/);
    expect(html).toContain('data-submit="wautoSalvar"');
  });
});
