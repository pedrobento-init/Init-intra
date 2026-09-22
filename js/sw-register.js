if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        console.log('SW registrado:', reg.scope);
        reg.addEventListener('updatefound', () => {
          var newSW = reg.installing;
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'activated' && navigator.serviceWorker.controller) {
              console.log('🔄 Nova versão detectada — recarregando...');
              // Não recarrega no meio de um sync pendente: adia 30s para não
              // perder writes ainda não enviados ao servidor.
              try {
                const pending = (typeof getPendingSyncCount === 'function') ? getPendingSyncCount() : 0;
                if (pending > 0) {
                  console.log('⏳ Sync pendente — adiando reload da nova versão...');
                  setTimeout(() => window.location.reload(), 30000);
                  return;
                }
              } catch (_) {}
              window.location.reload();
            }
          });
        });
      })
      .catch(err => console.warn('SW não registrado:', err.message));
  });
}
