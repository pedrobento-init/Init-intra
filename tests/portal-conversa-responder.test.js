import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// O handler depende do Deno, do SMTP e da WAHA; como no resto das functions, a
// trava é no fonte. O comportamento que importa aqui é o histórico do portal:
// responder é atendimento novo, nota interna é só para a equipe.
const src = fs
  .readFileSync(fileURLToPath(new URL('../supabase/functions/conversa-responder/index.ts', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

describe('conversa-responder: histórico do portal', () => {
  it('resposta real reabre a conversa encerrada, nota interna não', () => {
    expect(src).toContain('? statusQuery.eq("status", "pendente")');
    expect(src).toContain(': statusQuery.in("status", ["pendente", "encerrado"])');
  });

  it('grava a resposta como saída e a nota como interna', () => {
    expect(src).toContain('direcao: interna ? "interna" : "saida"');
  });

  it('o WhatsApp só responde para quem já escreveu para a empresa', () => {
    expect(src).toContain('.from("whatsapp_conversas")');
    expect(src).toContain('"not_whatsapp_contact"');
  });
});
