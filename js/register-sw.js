'use strict';

(function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.info('[SW] Browser tidak mendukung Service Worker — fitur offline tidak aktif.');
    return;
  }

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        '/service-worker.js',   
        { scope: '/' }
      );

      console.info('[SW] Terdaftar dengan scope:', registration.scope);

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.info('[SW] Versi baru tersedia. Muat ulang halaman untuk menerapkan.');
          }
        });
      });

    } catch (err) {
      console.error('[SW] Pendaftaran gagal:', err);
    }
  });
})();
