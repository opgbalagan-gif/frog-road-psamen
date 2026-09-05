/* Only game binaries use this loader; it never touches saved game data. */
(function (root) {
    'use strict';
    function createDelivery(env = root) {
        const ready = new Map();
        const stats = {networkBytes: 0, cachedBytes: 0, fallbackFiles: 0, cacheHits: 0};
        let assets = [], progress = () => {}, cache = null;
        const counts = new Map();
        const base = env.document ? env.document.baseURI : 'https://frog-road.test/';
        const scope = new URL('.', base);
        const cacheName = 'frog-road-binaries-v1:' + scope.pathname;
        const absolute = file => new URL(file, scope).href;
        const bounded = (promise, timeout = 1500) => new Promise((resolve, reject) => {
            const timer = env.setTimeout(() => reject(new Error('Storage timeout')), timeout);
            promise.then(value => { env.clearTimeout(timer); resolve(value); },
                error => { env.clearTimeout(timer); reject(error); });
        });
        function report(file, bytes) {
            counts.set(file, bytes);
            progress([...counts.values()].reduce((a, b) => a + b, 0),
                assets.reduce((sum, asset) => sum + asset.compressedSize, 0));
        }
        async function verify(buffer, asset) {
            if (buffer.byteLength !== asset.size) throw new Error('Incomplete file: ' + asset.file);
            if (env.crypto && env.crypto.subtle) {
                const digest = await env.crypto.subtle.digest('SHA-256', buffer);
                const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
                if (hash !== asset.sha256) throw new Error('Damaged file: ' + asset.file);
            }
            return buffer;
        }
        async function unpack(bytes, asset) {
            const stream = new env.Response(bytes).body.pipeThrough(new env.DecompressionStream('gzip'));
            return verify(await new env.Response(stream).arrayBuffer(), asset);
        }
        async function download(file, asset, compressed) {
            const controller = new env.AbortController();
            let timer;
            // Slow connections may take minutes; only a stalled connection times out.
            const touch = () => {
                env.clearTimeout(timer);
                timer = env.setTimeout(() => controller.abort(), 30000);
            };
            touch();
            try {
                const response = await env.fetch(absolute(file), {signal: controller.signal});
                if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + file);
                const reader = response.body.getReader(), chunks = [];
                let received = 0;
                while (true) {
                    const part = await reader.read();
                    if (part.done) break;
                    touch();
                    chunks.push(part.value);
                    received += part.value.byteLength;
                    stats.networkBytes += part.value.byteLength;
                    report(asset.file, Math.min(asset.compressedSize,
                        compressed ? received : received / asset.size * asset.compressedSize));
                }
                const bytes = new Uint8Array(received);
                let offset = 0;
                for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
                return bytes;
            } finally { env.clearTimeout(timer); }
        }
        async function load(asset) {
            let buffer, compressed;
            const url = absolute(asset.gzip);
            if (typeof env.DecompressionStream === 'function') {
                if (cache) {
                    try {
                        const hit = await bounded(cache.match(url));
                        if (hit) {
                            const bytes = await hit.arrayBuffer();
                            buffer = await unpack(bytes, asset);
                            stats.cachedBytes += bytes.byteLength;
                            stats.cacheHits++;
                            report(asset.file, asset.compressedSize);
                        }
                    } catch (_) { try { await bounded(cache.delete(url)); } catch (_) {} }
                }
                if (!buffer) {
                    for (let attempt = 0; attempt < 2; attempt++) {
                        try {
                            compressed = await download(asset.gzip, asset, true);
                            buffer = await unpack(compressed, asset);
                            break;
                        } catch (_) { /* A legacy host or interrupted download can use the raw file. */ }
                    }
                    if (buffer && cache) {
                        try { await bounded(cache.put(url, new env.Response(compressed,
                            {headers: {'Content-Type': 'application/gzip'}}))); } catch (_) {}
                    }
                }
            }
            if (!buffer) {
                stats.fallbackFiles++;
                buffer = await verify((await download(asset.file, asset, false)).buffer, asset);
            }
            ready.set(absolute(asset.file), {buffer, type: asset.type});
            report(asset.file, asset.compressedSize);
        }
        return {
            async prepare(manifest, onProgress) {
                assets = manifest;
                progress = onProgress || (() => {});
                try { cache = env.caches ? await bounded(env.caches.open(cacheName)) : null; } catch (_) {}
                await Promise.all(assets.map(load));
            },
            fetch(file) {
                const url = absolute(file), asset = ready.get(url);
                if (!asset) return env.fetch(url);
                ready.delete(url);
                // Transfer the already verified bytes without another full-buffer copy.
                const stream = new env.ReadableStream({start(controller) {
                    controller.enqueue(new Uint8Array(asset.buffer)); controller.close();
                }});
                return Promise.resolve(new env.Response(stream, {headers: {
                    'Content-Type': asset.type, 'Content-Length': String(asset.buffer.byteLength)
                }}));
            },
            async prune() {
                if (!cache) return;
                const keep = new Set(assets.map(asset => absolute(asset.gzip)));
                try {
                    for (const request of await bounded(cache.keys())) {
                        if (!keep.has(request.url)) await bounded(cache.delete(request));
                    }
                } catch (_) {}
            },
            snapshot() { return {...stats, pendingFiles: ready.size}; }
        };
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = {createDelivery};
    else root.FrogRoadDelivery = createDelivery();
})(globalThis);
