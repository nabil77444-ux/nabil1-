/* Firebase Cloud Messaging Background Service Worker — Taibah Net (TAIBAH NET) */
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { notification: { title: 'كروت طيبة نت — TAIBAH NET', body: event.data.text() } };
  }

  const notificationTitle = payload.notification?.title || 'كروت طيبة نت — شبكة طيبة نت اللاسلكية';
  const targetRoute = payload.data?.targetRoute || 'home';
  const notificationOptions = {
    body: payload.notification?.body || 'لديك إشعار جديد في النظام',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    dir: 'rtl',
    lang: 'ar',
    vibrate: [160, 80, 160],
    requireInteraction: true,
    tag: `taibah_${payload.data?.category || 'general'}_${Date.now()}`,
    data: {
      url: `/?route=${encodeURIComponent(targetRoute)}`,
    },
  };

  event.waitUntil(self.registration.showNotification(notificationTitle, notificationOptions));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
