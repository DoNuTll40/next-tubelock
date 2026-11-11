self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET') return;

  event.respondWith(fetch(event.request).catch(() => new Response(
    `<!doctype html>
<html lang="th">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>TubeLock — ออฟไลน์</title>
<main style="max-width:32rem;margin:12vh auto;padding:1.25rem;font:1rem system-ui">
  <h1>เปิด TubeLock ไม่ได้</h1>
  <p>ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต แล้วลองอีกครั้ง</p>
  <button type="button" onclick="location.reload()">ลองอีกครั้ง</button>
</main>
</html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )));
});
