import { defineConfig, configDefaults } from 'vitest/config';

// Sem config, o vitest varria também `.claude/worktrees/*` (cópias do repo que
// os agentes criam via `git worktree`, como o AGENTS.md recomenda) e rodava os
// testes de cada cópia, com falhas que não eram do código em edição.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/worktrees/**', 'e2e/**'],
  },
});
