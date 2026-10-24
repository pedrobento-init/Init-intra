import { describe, it, expect } from 'vitest';
import {
  aplicarEmail, assuntoLimpo, backupAlerta, briefingDados, briefingHtml, briefingTemConteudo, classificarBackup,
  clienteDoEmail, diasSemComunicar, monitorDoEmail, nomeDoRemetente, pendenciaDaTriagem, pendenciaDoAlerta,
  itensDaIa, primeiraRespostaDue, textoDaIa, triagemDaIa, corpoLimpo, remetenteInterno, dominiosInternos,
} from '../supabase/functions/robo/campo.ts';

const today = '2026-10-21';

describe('briefing antes da visita', () => {
  const visita = { id: 'V0', client_name: 'Acme', date: today, time: '14:00:00', motivo: 'Formatação', status: 'agendada',
    observacoes: 'Falar com a Ana', levar: [{ t: 'Pendrive', ok: false }] };
  const ctx = {
    today,
    visitas: [
      { id: 'V1', date: '2026-09-01', motivo: 'Rede', status: 'concluida', relatorio: 'Troquei o switch.' },
      { id: 'V2', date: '2026-10-01', motivo: 'Impressora', status: 'concluida', relatorio: '' },
      { id: 'V3', date: '2026-08-01', motivo: 'Antiga', status: 'concluida' },
      { id: 'V4', date: '2026-07-01', motivo: 'Mais antiga', status: 'concluida' },
      { id: 'V5', date: '2026-10-10', motivo: 'Cancelada', status: 'cancelada' },
    ],
    pendencias: [
      { id: 'P1', assunto: 'Toner', status: 'aberto', deadline: '2026-10-15', priority: 'alta' },
      { id: 'P2', assunto: 'Fechada', status: 'resolvido' },
    ],
    vencimentos: [
      { id: 'X1', tipo: 'ssl', descricao: 'SSL acme.com', data_vencimento: '2026-11-01', status: 'ativo' },
      { id: 'X2', tipo: 'licenca', descricao: 'Longe', data_vencimento: '2027-06-01', status: 'ativo' },
    ],
    devices: [
      { hostname: 'PC-01', is_ativo: true, data_ultima_atualizacao: '2026-10-01T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
      { hostname: 'PC-02', is_ativo: true, data_ultima_atualizacao: '2026-10-19T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
      { hostname: 'PC-03', is_ativo: false, data_ultima_atualizacao: '2026-01-01T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
    ],
    monitores: [{ id: 'M1', client_id: 'C', nome: 'Veeam', identificador: 'veeam', max_horas: 48, ultimo_status: 'falha' }],
  };
  const b = briefingDados(visita, ctx);

  it('últimas 3 visitas concluídas, mais nova primeiro', () => {
    expect(b.ultimas_visitas.map((x) => x.motivo)).toEqual(['Impressora', 'Rede', 'Antiga']);
  });
  it('pendências abertas (atrasada marcada), vencimentos em até 45 dias, dispositivo parado há >7 dias, backup com falha', () => {
    expect(b.pendencias_abertas).toEqual([{ assunto: 'Toner', status: 'aberto', prioridade: 'alta', prazo: '2026-10-15', atrasada: true }]);
    expect(b.vencimentos_proximos.map((x) => x.descricao)).toEqual(['SSL acme.com']);
    expect(b.dispositivos_sem_comunicar).toEqual([{ nome: 'PC-01', dias: 19 }]);
    expect(b.backups).toEqual([{ nome: 'Veeam', status: 'falha', ultimo: '' }]);
    expect(b.levar).toEqual(['Pendrive']);
    expect(briefingTemConteudo(b)).toBe(true);
  });
  it('HTML com fatos e o texto da IA escapado', () => {
    const h = briefingHtml(b, 'Atenção ao <switch>');
    expect(h).toContain('💡 Atenção ao &lt;switch&gt;');
    expect(h).toContain('Toner');
    expect(h).toContain('(atrasada)');
    expect(h).toContain('PC-01 — 19 dias');
    expect(h).toContain('Veeam');
  });
  it('texto corrido para o prompt da IA', async () => {
    const { briefingTexto } = await import('../supabase/functions/robo/campo.ts');
    const t = briefingTexto(b);
    expect(t).toContain('Cliente: Acme');
    expect(t).toContain('Visita: 21/10/2026 14:00 — motivo: Formatação');
    expect(t).toContain('- Toner (aberto, prioridade alta, ATRASADA)');
    expect(t).toContain('- PC-01: 19 dias');
    expect(t).toContain('- Veeam: falha');
  });
  it('cliente sem histórico nenhum não gera briefing', () => {
    const vazio = briefingDados(visita, { today, visitas: [], pendencias: [], vencimentos: [], devices: [], monitores: [] });
    expect(briefingTemConteudo(vazio)).toBe(false);
  });
  it('resposta do Make: JSON {texto}, texto puro, ou "Accepted" (sem resposta configurada)', () => {
    expect(textoDaIa('{"texto":"  Leve o cabo. "}')).toBe('Leve o cabo.');
    expect(textoDaIa('Leve o cabo.')).toBe('Leve o cabo.');
    expect(textoDaIa('Accepted')).toBeNull();
    expect(textoDaIa('')).toBeNull();
    // Teto padrão é do briefing; o relatório da visita passa um maior.
    expect(textoDaIa('x'.repeat(2000))).toHaveLength(1200);
    expect(textoDaIa('x'.repeat(2000), 8000)).toHaveLength(2000);
  });
  it('dispositivo: dias sem comunicar medidos na última sincronização', () => {
    expect(diasSemComunicar({ is_ativo: true, data_ultima_atualizacao: '2026-10-19T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' })).toBeNull();
    expect(diasSemComunicar({ is_ativo: true, data_ultima_atualizacao: '2026-10-01T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' })).toBe(19);
  });
});

describe('backup por e-mail', () => {
  it('classifica pelo assunto (falha > aviso > ok) e, sem pista, pelo corpo', () => {
    expect(classificarBackup('[Success] Job Servidor (2 VMs)')).toBe('ok');
    expect(classificarBackup('[Failed] Job Servidor')).toBe('falha');
    expect(classificarBackup('[Warning] Job Servidor')).toBe('aviso');
    expect(classificarBackup('Backup concluído com sucesso')).toBe('ok');
    expect(classificarBackup('Backup FALHOU no NAS')).toBe('falha');
    expect(classificarBackup('Relatório diário', 'Status: Sucesso. Erros: 0')).toBe('ok');
    expect(classificarBackup('Relatório diário', 'Nada a dizer')).toBeNull();
  });
  const mons = [
    { id: 'M1', client_id: 'C1', nome: 'Veeam', identificador: 'veeam', max_horas: 48, ativo: true },
    { id: 'M2', client_id: 'C2', nome: 'Veeam Acme', identificador: 'Job Acme', max_horas: 48, ativo: true },
    { id: 'M3', client_id: 'C3', nome: 'Off', identificador: 'nas', max_horas: 48, ativo: false },
  ];
  it('acha o monitor pelo identificador (o mais específico vence; inativo não)', () => {
    expect(monitorDoEmail(mons, { id: 'e', de: 'veeam@x.com', assunto: '[Success] Job ACME', data: '' }).id).toBe('M2');
    expect(monitorDoEmail(mons, { id: 'e', de: 'veeam@x.com', assunto: '[Success] Outro', data: '' }).id).toBe('M1');
    expect(monitorDoEmail(mons, { id: 'e', de: 'nas@x.com', assunto: 'ok', data: '' })).toBeNull();
  });
  it('e-mail mais antigo não sobrescreve o último status, mas entra no histórico', () => {
    const m = { ...mons[0], ultimo_status: 'ok', ultimo_em: '2026-10-21T08:00:00Z', historico: [] };
    const r = aplicarEmail(m, { id: 'e', de: '', assunto: '[Failed] velho', data: '2026-10-20T08:00:00Z' }, 'falha');
    expect(r.ultimo_status).toBe('ok');
    expect(r.historico).toHaveLength(1);
    expect(aplicarEmail(m, { id: 'e', de: '', assunto: '[Failed] novo', data: '2026-10-21T09:00:00Z' }, 'falha').ultimo_status).toBe('falha');
  });
  it('alerta: falha no último e-mail, ou silêncio além do limite (desde a criação se nunca chegou)', () => {
    const agora = new Date('2026-10-21T12:00:00Z');
    expect(backupAlerta({ ...mons[0], ultimo_status: 'falha', ultimo_em: '2026-10-21T08:00:00Z' }, agora)).toEqual({ tipo: 'falha' });
    expect(backupAlerta({ ...mons[0], ultimo_status: 'ok', ultimo_em: '2026-10-20T12:00:00Z' }, agora)).toBeNull();
    expect(backupAlerta({ ...mons[0], ultimo_status: 'ok', ultimo_em: '2026-10-18T12:00:00Z' }, agora)).toEqual({ tipo: 'silencio', horas: 72 });
    expect(backupAlerta({ ...mons[0], created_at: '2026-10-21T00:00:00Z' }, agora)).toBeNull();
    expect(backupAlerta({ ...mons[2], ultimo_status: 'falha' }, agora)).toBeNull();
  });
  it('pendência automática com os valores válidos da 056', () => {
    const p = pendenciaDoAlerta({ ...mons[0], client_name: 'Acme', team: 'mam', responsavel: 'Beto' }, { tipo: 'silencio', horas: 72 }, 'PEN-1');
    expect(p).toMatchObject({ id: 'PEN-1', client_id: 'C1', team: 'mam', responsible: 'Beto', status: 'aberto', priority: 'alta',
      canal: 'proativo', categoria: 'backup', tipo: 'Manutenção', assunto: 'Backup sem notícia há 72 h: Veeam' });
  });
});

describe('triagem de e-mail', () => {
  const clientes = [
    { id: 'C1', name: 'Padaria Pão Quente', team: 'init', technician: 'Pedro', emails: { domain: 'paoquente.com.br' } },
    { id: 'C2', name: 'Acme', team: 'mam', technician: 'Beto', emails: {} },
    { id: 'C3', name: 'Mercado do Zé', team: 'init', technician: '', emails: { domain: 'gmail.com' } },
  ];
  const email = { id: 'm1', de: 'Márcia Souza <marcia@filial.paoquente.com.br>', assunto: 'Re: Enc: impressora parada',
    data: '2026-10-21T13:20:00Z', trecho: 'A impressora do faturamento parou.' };

  it('casa o cliente pelo domínio da ficha, inclusive em subdomínio', () => {
    expect(clienteDoEmail(clientes, email).id).toBe('C1');
  });
  it('sem domínio na ficha, casa pelo nome do cliente no assunto', () => {
    expect(clienteDoEmail(clientes, { ...email, de: 'joao@provedor.net', assunto: 'Chamado Acme: sem rede' }).id).toBe('C2');
  });
  it('domínio de e-mail grátis não casa cliente nenhum', () => {
    expect(clienteDoEmail(clientes, { ...email, de: 'alguem@gmail.com', assunto: 'oi' })).toBeNull();
  });
  it('assunto perde os Re:/Enc: e o remetente dá o solicitante', () => {
    expect(assuntoLimpo('Re: Enc: impressora parada')).toBe('impressora parada');
    expect(nomeDoRemetente(email.de)).toBe('Márcia Souza');
    expect(nomeDoRemetente('marcia@paoquente.com.br')).toBe('marcia');
  });
  it('resposta do Make validada contra as listas fechadas', () => {
    const t = triagemDaIa(JSON.stringify({ assunto: 'Impressora do faturamento não imprime', descricao: 'Parou ontem.',
      categoria: 'impressora', prioridade: 'alta', tipo: 'Suporte', solicitante: 'Márcia', ignorar: false }), email);
    expect(t).toMatchObject({ ignorar: false, categoria: 'impressora', prioridade: 'alta', tipo: 'Suporte', semIa: false });
  });
  it('categoria e tipo inventados caem no padrão, e crítica para em alta', () => {
    const t = triagemDaIa(JSON.stringify({ categoria: 'nuvem', tipo: 'Urgência', prioridade: 'critica' }), email);
    expect(t).toMatchObject({ categoria: 'outro', tipo: 'Suporte', prioridade: 'alta' });
  });
  it('propaganda vem marcada para ignorar', () => {
    expect(triagemDaIa(JSON.stringify({ assunto: '50% OFF', ignorar: true }), email).ignorar).toBe(true);
  });
  it('Make fora do ar: vale o texto do próprio e-mail, com marca de sem-IA', () => {
    const t = triagemDaIa('Accepted', email);
    expect(t).toMatchObject({ assunto: 'impressora parada', descricao: 'A impressora do faturamento parou.',
      categoria: 'outro', prioridade: 'media', tipo: 'Suporte', solicitante: 'Márcia Souza', semIa: true, ignorar: false });
    expect(pendenciaDaTriagem(t, email, clientes[1], 'PEN-2').tags).toEqual(['triagem-automatica', 'sem-classificacao-ia']);
  });
  it('prazo de 1ª resposta em horas úteis, igual ao js/sla.js', () => {
    // Sexta 17:00 de Brasília + 4 h úteis → segunda 11:00 (14:00 UTC).
    expect(primeiraRespostaDue('alta', new Date('2026-10-16T20:00:00Z'))).toBe('2026-10-19T14:00:00.000Z');
    // Sábado: começa na abertura do próximo dia útil.
    expect(primeiraRespostaDue('critica', new Date('2026-10-17T23:00:00Z'))).toBe('2026-10-19T12:00:00.000Z');
  });
  it('pendência da triagem com os valores válidos da 056', () => {
    const t = triagemDaIa(JSON.stringify({ assunto: 'Impressora não imprime', descricao: 'Parou ontem.',
      categoria: 'impressora', prioridade: 'alta', tipo: 'Suporte', solicitante: 'Márcia' }), email);
    const p = pendenciaDaTriagem(t, email, clientes[0], 'PEN-1', new Date('2026-10-21T13:30:00Z'));
    expect(p).toMatchObject({ id: 'PEN-1', client_id: 'C1', client_name: 'Padaria Pão Quente', team: 'init',
      responsible: 'Pedro', solicitante: 'Márcia', status: 'aberto', priority: 'alta', canal: 'email',
      categoria: 'impressora', tipo: 'Suporte', assunto: 'Impressora não imprime', tags: ['triagem-automatica'] });
    expect(p.descricao).toContain('Assunto original: Re: Enc: impressora parada');
    expect(p.first_response_due).toBe('2026-10-21T17:30:00.000Z');  // 10:30 + 4 h úteis = 14:30 de Brasília
  });

  // Caminho de volta (064): sem estes dois a resposta pela tela não existe.
  it('guarda o endereço de quem pediu e o Message-ID, para responder na mesma conversa', () => {
    const comId = { ...email, message_id: '<CAF123@mail.gmail.com>' };
    const p = pendenciaDaTriagem(triagemDaIa('Accepted', comId), comId, clientes[0], 'PEN-3');
    expect(p.solicitante_email).toBe('marcia@filial.paoquente.com.br');
    expect(p.email_message_id).toBe('<CAF123@mail.gmail.com>');
  });

  it('e-mail antigo, sem Message-ID, abre pendência do mesmo jeito', () => {
    const p = pendenciaDaTriagem(triagemDaIa('Accepted', email), email, clientes[0], 'PEN-4');
    expect(p.email_message_id).toBeNull();
    expect(p.solicitante_email).toBe('marcia@filial.paoquente.com.br');
    expect(p.status).toBe('aberto');
  });
});

describe('o que levar sugerido pela IA', () => {
  it('uma linha por item, sem numeração, hífen, repetido nem o que já está na lista', () => {
    const resposta = '- Cabo de rede\n1) Alicate de crimpar\n* Cabo de rede\nConectores RJ45.\n\n  Testador de cabo  ';
    expect(itensDaIa(resposta, ['alicate de crimpar']))
      .toEqual(['Cabo de rede', 'Conectores RJ45', 'Testador de cabo']);
  });
  it('resposta vazia, "Accepted" ou "nada a levar" não sugere nada', () => {
    expect(itensDaIa('Accepted')).toEqual([]);
    expect(itensDaIa('')).toEqual([]);
    expect(itensDaIa('Nada além do básico')).toEqual([]);
  });
  it('corta no máximo de itens e no tamanho do campo', () => {
    const muitos = Array.from({ length: 20 }, (_, i) => 'Item ' + (i + 1)).join('\n');
    expect(itensDaIa(muitos)).toHaveLength(8);
    expect(itensDaIa(muitos, [], 3)).toEqual(['Item 1', 'Item 2', 'Item 3']);
    expect(itensDaIa('x'.repeat(200))[0]).toHaveLength(120);
  });
});

describe('corpoLimpo: só o que a pessoa escreveu agora', () => {
  // O caso que abriu esta correção: resposta do Felipe (Init) na conversa da
  // Beatriz. A descrição do chamado terminava no meio de "Em qui., 22 de".
  const respostaReal = [
    'Bom dia Beatriz, td bem e espero que também esteja tudo bem.',
    'Desculpa a demora no retorno, mas ontem estava em visita a cliente fora de SP.',
    '',
    'Podemos agendar uma avaliação em seu notebook na segunda-feira (26/10) no período da manhã?',
    '',
    'Obrigado,',
    'Felipe Ferezin',
    '+55 (11) 4478 6171 | 4902 4359',
    'http://www.initnet.com.br',
    '',
    'Em qui., 22 de out. de 2026 às 09:14, Beatriz Rangel <beatriz@diasrizzo.com.br>',
    'escreveu:',
    '',
    '> Bom dia Felipe, consegue olhar meu notebook?',
    '> Obrigada',
  ].join('\n');

  it('corta a conversa citada e a assinatura, e guarda a despedida', () => {
    const limpo = corpoLimpo(respostaReal);
    expect(limpo).toContain('Bom dia Beatriz');
    expect(limpo).toContain('segunda-feira (26/10)');
    expect(limpo.endsWith('Obrigado,')).toBe(true);
  });

  it('nada da conversa citada sobra', () => {
    const limpo = corpoLimpo(respostaReal);
    expect(limpo).not.toContain('Em qui., 22 de');
    expect(limpo).not.toContain('escreveu:');
    expect(limpo).not.toContain('consegue olhar meu notebook');
  });

  it('nem o telefone e o site da assinatura', () => {
    const limpo = corpoLimpo(respostaReal);
    expect(limpo).not.toContain('4478 6171');
    expect(limpo).not.toContain('initnet.com.br');
  });

  it('o delimitador "-- " do RFC corta sozinho', () => {
    const e = 'A impressora parou de imprimir hoje de manhã.\n\n-- \nAna Paula\nDias Rizzo';
    expect(corpoLimpo(e)).toBe('A impressora parou de imprimir hoje de manhã.');
  });

  it('cabeçalho de encaminhamento do Outlook também é citação', () => {
    const e = 'Segue abaixo o chamado que abrimos ontem, sem retorno.\n\n'
      + 'De: Suporte <suporte@x.com.br>\nEnviada em: quarta-feira, 21 de outubro\nPara: Ana\nAssunto: Chamado';
    expect(corpoLimpo(e)).toBe('Segue abaixo o chamado que abrimos ontem, sem retorno.');
  });

  it('linha citada com ">" corta a partir dali', () => {
    const e = 'Continua sem acesso ao servidor de arquivos.\n\n> Pode testar de novo agora?';
    expect(corpoLimpo(e)).toBe('Continua sem acesso ao servidor de arquivos.');
  });

  // Errar para MENOS: na dúvida o texto fica.
  it('despedida seguida de TEXTO de verdade não é assinatura', () => {
    const e = 'Obrigado,\n\nMas ainda preciso do orçamento do notebook novo antes de sexta.';
    expect(corpoLimpo(e)).toContain('orçamento do notebook novo');
  });

  it('e-mail curto sem marcador nenhum atravessa inteiro', () => {
    const e = 'A impressora do faturamento parou de novo, pode olhar?';
    expect(corpoLimpo(e)).toBe(e);
  });

  it('se o corte não deixaria quase nada, devolve o original', () => {
    // Tudo é citação: cortar deixaria uma descrição vazia no chamado.
    const e = '> Bom dia, o servidor de arquivos continua fora do ar desde ontem.';
    expect(corpoLimpo(e)).toContain('servidor de arquivos');
  });

  it('vazio continua vazio, sem inventar texto', () => {
    expect(corpoLimpo('')).toBe('');
    expect(corpoLimpo('   \n  ')).toBe('');
  });

  it('CRLF do Outlook não atrapalha o corte', () => {
    const e = 'O notebook não liga mais.\r\n\r\nEm qui., 22 de out. de 2026, Ana <a@x.com> escreveu:\r\n> teste';
    expect(corpoLimpo(e)).toBe('O notebook não liga mais.');
  });
});

describe('triagem: e-mail da própria Init não vira chamado', () => {
  // O robô varre a CONVERSA inteira do rótulo: a nossa resposta ao cliente
  // chegava como mensagem nova e abria chamado com o técnico de solicitante.
  const dominios = dominiosInternos('suporte@initnet.com.br');

  it('o domínio de casa sai do GMAIL_USER, sem secret novo', () => {
    expect(dominios).toEqual(['initnet.com.br']);
    expect(dominiosInternos('')).toEqual([]);
    expect(dominiosInternos('suporte')).toEqual([]);
  });

  it('resposta do técnico é interna', () => {
    expect(remetenteInterno('Felipe Ferezin <ferezin@initnet.com.br>', dominios)).toBe(true);
  });

  it('subdomínio nosso também é interno', () => {
    expect(remetenteInterno('robo <no-reply@mail.initnet.com.br>', dominios)).toBe(true);
  });

  it('cliente nunca é interno, nem com o nome parecido', () => {
    expect(remetenteInterno('Beatriz <beatriz@diasrizzo.com.br>', dominios)).toBe(false);
    // Domínio que só TERMINA parecido não pode passar por nosso.
    expect(remetenteInterno('fulano <x@naoinitnet.com.br>', dominios)).toBe(false);
  });

  it('sem domínio configurado, ninguém é barrado', () => {
    expect(remetenteInterno('Felipe <ferezin@initnet.com.br>', [])).toBe(false);
  });

  it('remetente sem e-mail nenhum não é interno', () => {
    expect(remetenteInterno('Felipe Ferezin', dominios)).toBe(false);
  });
});

describe('a descrição do chamado já nasce limpa', () => {
  const email = { id: 'M9', de: 'Beatriz <beatriz@diasrizzo.com.br>', assunto: 'Re: Notebook',
    data: '2026-10-24T13:05:00Z',
    trecho: 'O notebook não liga desde ontem.\n\nAtenciosamente,\nBeatriz\n(11) 99999-0000\n\n'
      + 'Em qua., 21 de out. de 2026, Suporte <suporte@initnet.com.br> escreveu:\n> Bom dia' };

  it('sem IA, o fallback é o corpo limpo e não o e-mail cru', () => {
    const t = triagemDaIa('Accepted', email);
    expect(t.descricao).toContain('O notebook não liga desde ontem.');
    expect(t.descricao).not.toContain('escreveu:');
    expect(t.descricao).not.toContain('99999-0000');
  });

  it('com IA, quem manda segue sendo a descrição da IA', () => {
    const t = triagemDaIa(JSON.stringify({ descricao: 'Notebook não liga.' }), email);
    expect(t.descricao).toBe('Notebook não liga.');
  });
});
