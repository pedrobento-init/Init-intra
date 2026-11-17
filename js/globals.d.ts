// js/globals.d.ts — só para o `npm run typecheck`; não é carregado pelo app
// nem entra no bundle (build-assets lê apenas os <script> do index.html).
//
// Os scripts de js/ compartilham um único escopo global. Com checkJs desligado
// por padrão e `// @ts-check` por arquivo, o tsc enxerga todas as funções/consts
// de topo de js/**/*.js como globais reais. Aqui entra só o que NÃO é declarado
// em nenhum arquivo do app: bibliotecas de CDN e o `module` dos exports de teste.

declare var module: { exports: any } | undefined;
declare var Chart: any;
declare var FullCalendar: any;
declare var Motion: any;
declare var XLSX: any;
declare var Dexie: any;

// Arquivos de js/ que exportam com `module.exports` (para os testes) são vistos
// pelo TypeScript como módulos CommonJS: o que declaram NÃO vira global aqui,
// mesmo sendo global no navegador. Quando um arquivo com @ts-check usa uma
// função assim, declare a assinatura abaixo (e só ela).
declare function _logSilent(err: unknown, where?: string): void;

// Globais pendurados em `window` por scripts do app.
interface Window {
  emitDataChanged: (entity: string, payload?: unknown) => void;
  onDataChanged: (entity: string, cb: (payload: unknown, entity: string) => void) => () => void;
  offDataChanged: (entity: string, cb: (payload: unknown, entity: string) => void) => void;
  preserveScrollAround: <T>(fn: () => T) => T;
}
