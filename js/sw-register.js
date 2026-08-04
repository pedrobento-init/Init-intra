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
              window.location.reload();
            }
          });
        });
      })
      .catch(err => console.warn('SW não registrado:', err.message));
  });
}
