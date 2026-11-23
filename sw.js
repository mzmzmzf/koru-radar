const CACHE_NAME = "quant-terminal-v20";
const ASSETS = [
    "./",
    "./index.html",
    "./styles/main.css",
    "./js/storage.js",
    "./js/market-feed.js",
    "./js/indicators.js",
    "./js/pyramid-math.js",
    "./js/macro-calendar.js",
    "./js/macro-intel.js",
    "./js/key-levels.js",
    "./js/whale-radar.js"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    let url;
    try {
        url = new URL(event.request.url);
    } catch (e) {
        return;
    }
    if (url.origin !== self.location.origin) return;

    // Network-First：优先获取最新静态资源，离线或弱网时回退本地缓存
    event.respondWith(
        fetch(event.request)
            .then((networkRes) => {
                if (networkRes && networkRes.ok) {
                    const resClone = networkRes.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
                }
                return networkRes;
            })
            .catch(() => caches.match(event.request))
    );
});
