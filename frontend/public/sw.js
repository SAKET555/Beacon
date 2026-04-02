self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Royal Beacon';
  const options = {
    body: data.body || 'You have a new notification',
    data: data.data || {},
    icon: '/beacon.svg'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = '/app';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/app')) return client.focus();
      }
      return clients.openWindow(target);
    })
  );
});
