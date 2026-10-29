// DriveApp falso para os testes do Robo.gs: só o que roboPastas usa. Pasta e
// arquivo guardam os pais e a lixeira, que é o que decide vincular, criar ou
// reportar; o resto do Drive (permissões, cotas) fica de fora de propósito.

function iterador(lista) {
  let i = 0;
  return { hasNext: () => i < lista.length, next: () => lista[i++] };
}

function criarDrive() {
  const itens = new Map();
  let seq = 0;

  function no(tipo, nome, pais, extra = {}) {
    const id = extra.id || `${tipo}-${++seq}`;
    const n = {
      tipo, id, nome, pais: [...pais], lixeira: !!extra.lixeira,
      getId: () => n.id,
      getName: () => n.nome,
      getUrl: () => (tipo === 'pasta' ? `https://drive.google.com/drive/folders/${n.id}` : `https://docs.google.com/spreadsheets/d/${n.id}`),
      getParents: () => iterador(n.pais.map((p) => itens.get(p))),
      isTrashed: () => n.lixeira,
      setName: (novo) => { n.nome = novo; return n; },
      moveTo: (destino) => { n.pais = [destino.getId()]; return n; },
    };
    if (tipo === 'pasta') {
      const filhas = () => [...itens.values()].filter((x) => x.tipo === 'pasta' && x.pais.includes(n.id));
      n.getFolders = () => iterador(filhas());
      n.getFoldersByName = (nome) => iterador(filhas().filter((x) => x.nome === nome));
      n.createFolder = (nome) => no('pasta', nome, [n.id]);
    }
    itens.set(id, n);
    return n;
  }

  function buscar(id, tipo) {
    const n = itens.get(id);
    // O Apps Script lança erro para id sem acesso ou inexistente.
    if (!n || n.tipo !== tipo) throw new Error(`Não encontrado: ${id}`);
    return n;
  }

  return {
    itens,
    pasta: (nome, pais = [], extra) => no('pasta', nome, pais, extra),
    arquivo: (nome, pais = [], extra) => no('arquivo', nome, pais, extra),
    DriveApp: {
      getFolderById: (id) => buscar(id, 'pasta'),
      getFileById: (id) => buscar(id, 'arquivo'),
      createFolder: (nome) => no('pasta', nome, []),
    },
  };
}

module.exports = { criarDrive };
