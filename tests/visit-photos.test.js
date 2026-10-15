import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { visitPhotoScaledSize, visitPhotoPath } = require('../js/visit-photos.js');

describe('fotos da visita', () => {
  it('reduz o lado maior para 1600 mantendo a proporção', () => {
    expect(visitPhotoScaledSize(4000, 3000)).toEqual({ w: 1600, h: 1200 });
    expect(visitPhotoScaledSize(3000, 4000)).toEqual({ w: 1200, h: 1600 });
  });
  it('não amplia foto pequena', () => {
    expect(visitPhotoScaledSize(800, 600)).toEqual({ w: 800, h: 600 });
  });
  it('dimensão inválida', () => {
    expect(visitPhotoScaledSize(0, 600)).toEqual({ w: 0, h: 0 });
  });
  it('caminho no bucket por visita', () => {
    expect(visitPhotoPath('VIS-1', 'VP-a')).toBe('visits/VIS-1/VP-a.jpg');
  });
});
