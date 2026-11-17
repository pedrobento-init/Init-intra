import js from '@eslint/js';
import globals from 'globals';
import { createRequire } from 'node:module';

// js/ não tem import/export: tudo que um script declara no topo é global para
// os demais. Em vez de manter uma lista à mão, lemos as declarações dos
// <script> do index.html (mesmo parser do tests/globais-colisao.test.js).
const { coletarDeclaracoes } = createRequire(import.meta.url)('./tools/globais-de-topo.js');
const globaisDoApp = Object.fromEntries(
  coletarDeclaracoes().declaracoes.map((d) => [d.nome, 'writable'])
);

export default [
  {
    ignores: ['node_modules/**', 'js/config.js', 'js/supabase-config.js'],
  },
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globaisDoApp,
        // Export condicional para testes: `if (typeof module !== 'undefined')`.
        // Globais que só existem via `window.X = ...` (o parser de topo não os
        // vê) ou que são opcionais, sempre guardados por `typeof` em runtime.
        debouncedRenderPenView: 'readonly',
        debouncedRenderEquipView: 'readonly',
        debouncedFilterOperadores: 'readonly',
        debouncedRenderVisitView: 'readonly',
        currentHash: 'readonly',
        renderReuniaoView: 'readonly',
        isMilvusMappingAdmin: 'readonly',
        download: 'readonly',
        CACHE_NAME: 'readonly', // definido no sw.js; lido por typeof no app
        Buffer: 'readonly', // ramo de fallback fora do navegador (testes)
        module: 'writable',
        require: 'readonly',
        supabase: 'readonly',
        Dexie: 'readonly',
        Chart: 'readonly',
        FullCalendar: 'readonly',
        Motion: 'readonly',
      },
    },
    rules: {
      // Os globais entre scripts vêm de `globaisDoApp` (declarações de topo
      // lidas do index.html): nome que não é de ninguém é erro de digitação.
      'no-undef': 'error',
      // vars: 'local' — funções/consts de topo são globais usados por outros
      // scripts e por onclick="..." no HTML; o ESLint não enxerga esse uso e
      // acusava ~800 falsos positivos. Variáveis locais seguem verificadas.
      'no-unused-vars': [
        'warn',
        {
          vars: 'local',
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'off',
      // catch vazio engolia falha em silêncio: use _logSilent (js/error-log.js)
      // ou comente por que ignorar. Variável de catch não usada: prefixe com _.
      'no-empty': ['error', { allowEmptyCatch: false }],
      // Pega `var x`/`function x` repetidos no mesmo arquivo. Colisão ENTRE
      // arquivos é coberta por tests/globais-colisao.test.js.
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
  {
    files: ['tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
];
