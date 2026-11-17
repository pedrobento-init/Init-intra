import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// Catraca do SEC-07 (style): o CSP do vercel.json bloqueia o atributo style no
// markup (style-src-attr 'none'). Estilo estático vira classe em
// css/utilidades.css; estilo que depende de dado vai em data-sty="..." e é
// aplicado por js/estilo-dinamico.js via CSSOM (que o CSP não bloqueia).
// Normaliza CRLF: o checkout no Windows quebra comparação de texto (rls-055).
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const ATTR = /\bstyle=["']/g;

// Único lugar onde style inline continua legítimo: HTML que sai do app e é lido
// fora dele (o CSS do app não existe lá). Faixa de linhas, para um style novo
// no resto do arquivo falhar.
const ALLOW = {
  'js/notifications.js': { de: 150, ate: 460, motivo: 'corpo de e-mail HTML (cliente de e-mail não carrega o CSS do app)' },
  'js/visitas.js': { de: 985, ate: 1215, motivo: 'exportação .xls do relatório de visitas (o Excel lê o HTML baixado)' },
};

const arquivos = () => fs.readdirSync('js').filter((f) => f.endsWith('.js')).map((f) => 'js/' + f).concat(['index.html']);

function ocorrencias(f) {
  const src = read(f);
  const linhas = [];
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(src))) linhas.push(src.slice(0, m.index).split('\n').length);
  return linhas;
}

describe('CSP: style-src sem unsafe-inline', () => {
  const csp = JSON.parse(read('vercel.json')).headers
    .flatMap((h) => h.headers)
    .find((h) => h.key === 'Content-Security-Policy').value;
  const diretiva = (nome) => (csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(nome + ' ')) || '');

  it("style-src e style-src-attr não liberam 'unsafe-inline'", () => {
    expect(diretiva('style-src')).not.toContain("'unsafe-inline'");
    expect(diretiva('style-src-attr')).toBe("style-src-attr 'none'");
  });

  it("style-src-elem mantém 'unsafe-inline' só por causa do FullCalendar (injeta <style> sem nonce)", () => {
    // Se o FullCalendar sair do projeto, tire o 'unsafe-inline' daqui e deste teste.
    expect(diretiva('style-src-elem')).toContain("'unsafe-inline'");
    expect(fs.readFileSync('js/ui.js', 'utf8')).toContain('fullcalendar@');
  });
});

describe('atributo style fora do markup do app', () => {
  it('nenhum style="..." no index.html nem em js/, exceto e-mail e exportação .xls', () => {
    for (const f of arquivos()) {
      const linhas = ocorrencias(f);
      const permitido = ALLOW[f];
      const fora = permitido ? linhas.filter((l) => l < permitido.de || l > permitido.ate) : linhas;
      expect(fora, `${f} linhas ${fora.join(',')}: use classe (css/utilidades.css) ou data-sty`).toEqual([]);
    }
  });

  it('a allowlist não envelhece: cada faixa ainda tem style inline', () => {
    for (const [f, { motivo }] of Object.entries(ALLOW)) expect(ocorrencias(f).length, f + ' — ' + motivo).toBeGreaterThan(0);
  });
});

describe('classes utilitárias (css/utilidades.css)', () => {
  const css = read('css/utilidades.css');
  const definidas = new Set([...css.matchAll(/\.(u-[0-9a-f]{6})\b/g)].map((m) => m[1]));

  it('toda classe u-xxxxxx usada no markup existe no CSS', () => {
    const faltando = [];
    for (const f of arquivos().concat(['tests/mentions.test.js'])) {
      for (const m of read(f).matchAll(/\bu-[0-9a-f]{6}\b/g)) if (!definidas.has(m[0])) faltando.push(f + ': ' + m[0]);
    }
    expect(faltando).toEqual([]);
  });

  it('display não leva !important (el.style.display do JS precisa continuar vencendo)', () => {
    expect(css).not.toMatch(/display:[^;}]*!important/);
  });

  it('o CSS é carregado pelo index.html e pelo service worker', () => {
    expect(read('index.html')).toContain('href="css/utilidades.css"');
    expect(read('sw.js')).toContain("'css/utilidades.css'");
  });
});

describe('js/estilo-dinamico.js', () => {
  // Carrega o script num contexto isolado (modo script, sem import/export).
  const ctx = vm.createContext({});
  vm.runInContext(read('js/estilo-dinamico.js'), ctx);
  const aplicar = (raw) => {
    const set = [];
    const el = { getAttribute: () => raw, style: { setProperty: (p, v, pr) => set.push([p, v, pr]) } };
    ctx._estiloDinamicoAplicar(el);
    return set;
  };

  it('aplica propriedades comuns e variáveis CSS', () => {
    expect(aplicar('width:40%;--c:#1a56db')).toEqual([['width', '40%', ''], ['--c', '#1a56db', '']]);
  });

  it('não corta rgba(...) no ponto e vírgula interno e respeita !important', () => {
    expect(aplicar('background:rgba(1,2,3,.5);color:red !important')).toEqual([['background', 'rgba(1,2,3,.5)', ''], ['color', 'red', 'important']]);
  });

  it('descarta url(), expression(), @import e propriedade malformada', () => {
    expect(aplicar('background:url(https://evil.example/x);width:expression(alert(1));--x:@import "a";0bad:1;color:red')).toEqual([['color', 'red', '']]);
  });

  it('atributo ausente ou vazio não faz nada', () => {
    expect(aplicar(null)).toEqual([]);
    expect(aplicar('')).toEqual([]);
  });
});
