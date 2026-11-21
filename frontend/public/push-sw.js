/* Được nạp vào service worker do Workbox sinh ra (importScripts). Xử lý Web Push và bấm vào thông báo. */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  // Safari bắt buộc phải hiện thông báo cho MỌI push (không có "silent push"), nên luôn hiện.
  event.waitUntil(
    self.registration.showNotification(data.title || "YT → MP3", {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: data.icon || "/icons/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          client.postMessage({ type: "navigate", url: target.pathname + target.search });
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
