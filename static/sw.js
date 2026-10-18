const CACHE_NAME = 'text2comic-v3';
const PRECACHE_URLS = [
  '/',
  '/static/design-system.css',
  '/static/icons.js',
  '/static/transitions.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // API 请求走网络优先
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) {
    return;
  }
  // ⚠️ /static/users/ 是**用户作品数据** (static/users/<账号>/works/<id>/images/*),
  // 绝不能进 Cache Storage: 它是 cache-first, 一旦缓存就会永久留在本机,
  // 之后同一浏览器的任何人 (换账号/退出登录) 都能离线看到, 用户把作品切回"私密"
  // 也收不回来 —— 服务端的权限校验根本轮不到执行.
  if (url.pathname.startsWith('/static/users/')) {
    return;
  }
  // 静态资源缓存优先
  if (event.request.method === 'GET' && (url.pathname.startsWith('/static/') || url.pathname === '/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => caches.match('/'));
      })
    );
  }
});
