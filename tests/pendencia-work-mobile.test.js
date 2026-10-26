import { createRequire as __partsReq } from 'node:module';
const { requireParts, partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// ── Regressão iPhone: bloco "Trabalhando agora" do detalhe da pendência ──
// Sintoma: em telas estreitas o .pen-work-side (flex-shrink:0 + .pen-time
// nowrap ~180px p/ "Nenhum tempo registrado") espremia o texto em ~100px e
// quebrava "Ninguém · Disponível". Correção: lado desce p/ linha cheia.
describe('contrato mobile do bloco pen-work no CSS', () => {
  const css = fs.readFileSync('css/styles.css', 'utf8');
  const norm = css.replace(/\s+/g, ' ');
  // Todos os blocos do breakpoint, não só o primeiro: o arquivo passou a ter
  // mais de um @media 640px (a caixa de entradas de e-mail, 066), e pegar
  // apenas `[1]` olhava o bloco errado — o teste falhava sem nada do pen-work
  // ter mudado.
  const mobile640 = norm.split('@media (max-width: 640px)').slice(1).join(' ');

  it('lado ocupa a linha cheia no mobile (não espreme o texto)', () => {
    expect(mobile640).toMatch(/\.pen-work-side\s*\{[^}]*flex-basis:\s*100%/);
  });

  it('lado pode encolher e quebra em linha (space-between)', () => {
    expect(mobile640).toMatch(/\.pen-work-side\s*\{[^}]*flex-shrink:\s*1/);
    expect(mobile640).toMatch(/\.pen-work-side\s*\{[^}]*justify-content:\s*space-between/);
    expect(mobile640).toMatch(/\.pen-work-side\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  it('tempo acumulado pode quebrar linha no mobile (sem overflow)', () => {
    expect(mobile640).toMatch(/\.pen-time\s*\{\s*white-space:\s*normal/);
  });

  it('base desktop preservada (lado fixo à direita, tempo nowrap)', () => {
    expect(norm).toMatch(/\.pen-work-side\s*\{[^}]*flex-shrink:\s*0/);
    expect(norm).toMatch(/\.pen-time\s*\{[^}]*white-space:\s*nowrap/);
  });
});

describe('estrutura do bloco pen-work no detalhe', () => {
  const src = partsSource('pendencias');

  it('detalhe renderiza faixa trabalhando-agora + tempo acumulado', () => {
    expect(src).toContain('pen-work');
    expect(src).toContain('Trabalhando agora');
    expect(src).toContain('Tempo acumulado');
    expect(src).toContain('pen-work-side');
    expect(src).toContain('pen-time');
  });
});
