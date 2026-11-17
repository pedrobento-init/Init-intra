import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'js/config.js',
      'js/supabase-config.js'
    ],
  },
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        supabase: 'readonly',
        Dexie: 'readonly',
        Chart: 'readonly',
        FullCalendar: 'readonly',
        Motion: 'readonly'
      }
    },
    rules: {
      // A base usa um único escopo global entre os scripts carregados via
      // <script> no index.html — cross-file globals são esperados.
      'no-undef': 'off',
      // vars: 'local' — funções/consts de topo são globais usados por outros
      // scripts e por onclick="..." no HTML; o ESLint não enxerga esse uso e
      // acusava ~800 falsos positivos. Variáveis locais seguem verificadas.
      'no-unused-vars': ['warn', { vars: 'local', args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all', caughtErrorsIgnorePattern: '^_' }],
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'off',
      // catch vazio engolia falha em silêncio: use _logSilent (js/error-log.js)
      // ou comente por que ignorar. Variável de catch não usada: prefixe com _.
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-redeclare': 'off'
    }
  },
  {
    files: ['tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }]
    }
  }
];
