// Service worker do Casa Aura Ultra.
//
// Estrategia deliberada, e a escolha importa:
//   - HTML: NUNCA cacheado. A casa muda; servir uma versao antiga do
//     imovel para um cliente e a pior falha que este produto pode ter.
//   - JS/CSS com hash no nome (build do Vite): cache-first e imutavel.
//     O nome muda quando o conteudo muda, entao nao ha invalidacao.
//   - Assets pesados (modelos, texturas, audio): stale-while-revalidate.
//     O corretor abre no stand em rede de operadora; a segunda abertura
//     tem de ser instantanea.
const CACHE = 'casa-aura-v1';
const IMUTAVEL = /\/assets\/.*-[A-Za-z0-9_-]{8,}\.(js|css|woff2?)$/;
const PESADO = /\.(glb|gltf|ktx2|hdr|basis|drc|mp3|ogg|jpg|png|webp)$/i;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const chaves = await caches.keys();
    await Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;         // fonte externa passa direto
  if (req.mode === 'navigate') return;                // HTML sempre da rede

  if (IMUTAVEL.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (PESADO.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      const rede = fetch(req).then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
      }).catch(() => hit);       // offline: fica com o que tem
      return hit || rede;
    })());
  }
});
