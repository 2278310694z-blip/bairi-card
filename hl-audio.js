/* Standalone same-origin bounded-range WAV loader. No template dependencies. */
(function (global) {
  'use strict';
  const CHUNK_BYTES = 4 * 1024 * 1024;
  const MAX_BYTES = 100 * 1024 * 1024;
  const active = new Set();
  const base = new URL('.', document.currentScript ? document.currentScript.src : document.baseURI);
  // srcdoc inherits its embedding origin, but location.origin can serialize as null.
  let documentOrigin = new URL(document.baseURI).origin;
  if (documentOrigin === 'null') {
    try { documentOrigin = global.parent.location.origin; } catch (_) { /* fail closed */ }
  }
  const trustedOrigin = base.protocol === 'https:' || (/^http:$/.test(base.protocol) && base.origin === documentOrigin) ? base.origin : null;
  const crossOrigin = trustedOrigin !== null && trustedOrigin !== documentOrigin;
  function aborted(signal) {
    if (signal && signal.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  }
  async function prepare(relativePath, options) {
    const signal = options instanceof AbortSignal ? options : options && options.signal;
    aborted(signal);
    if (typeof relativePath !== 'string' || !/^assets\/music\/[a-zA-Z0-9_-]+\.wav$/.test(relativePath)) {
      throw new TypeError('Only assets/music/*.wav relative paths are allowed');
    }
    const url = new URL(relativePath, base);
    if (!trustedOrigin || url.origin !== trustedOrigin || !url.pathname.startsWith(new URL('assets/music/', base).pathname)) {
      throw new TypeError('Audio must remain within same-origin assets/music/');
    }
    url.searchParams.set('hl_audio', 'range');
    const parts = [];
    let total = null;
    let etag = null;
    for (let offset = 0; total === null || offset < total; offset += CHUNK_BYTES) {
      aborted(signal);
      const end = total === null ? CHUNK_BYTES - 1 : Math.min(offset + CHUNK_BYTES - 1, total - 1);
      const response = await fetch(url.href, {
        signal,
        cache: 'no-store',
        mode: 'cors',
        credentials: crossOrigin ? 'omit' : 'same-origin',
        headers: { Range: 'bytes=' + offset + '-' + end }
      });
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (response.status !== 206 || !match) {
        if (response.body) await response.body.cancel();
        throw new Error('Expected HTTP206 with Content-Range, received ' + response.status + ' ' + response.statusText);
      }
      const startByte = Number(match[1]);
      const endByte = Number(match[2]);
      const size = Number(match[3]);
      if (!Number.isSafeInteger(size) || size < 44 || size > MAX_BYTES ||
          startByte !== offset || endByte !== Math.min(end, size - 1) ||
          (total !== null && size !== total)) {
        if (response.body) await response.body.cancel();
        throw new Error('Invalid Content-Range or WAV exceeds 100MiB');
      }
      const currentEtag = response.headers.get('etag');
      if (total !== null && etag !== currentEtag) {
        if (response.body) await response.body.cancel();
        throw new Error('Audio resource changed during range download');
      }
      total = size;
      etag = currentEtag;
      const expected = endByte - startByte + 1;
      const headerLength = response.headers.get('content-length');
      if (headerLength !== null && Number(headerLength) !== expected) {
        if (response.body) await response.body.cancel();
        throw new Error('Content-Length does not match Content-Range');
      }
      const reader = response.body.getReader();
      const slices = [];
      let received = 0;
      try {
        while (true) {
          aborted(signal);
          const item = await reader.read();
          if (item.done) break;
          received += item.value.byteLength;
          if (received > expected) {
            await reader.cancel();
            throw new Error('Range response exceeds expected byte count');
          }
          slices.push(item.value);
        }
      } finally { reader.releaseLock(); }
      if (received !== expected) throw new Error('Incomplete audio range');
      parts.push(new Blob(slices));
    }
    aborted(signal);
    const blob = new Blob(parts, { type: 'audio/wav' });
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (String.fromCharCode(...header.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...header.slice(8, 12)) !== 'WAVE') {
      throw new Error('Not a RIFF/WAVE file');
    }
    aborted(signal);
    const objectURL = URL.createObjectURL(blob);
    active.add(objectURL);
    return objectURL;
  }
  function release(url) {
    if (active.delete(url)) URL.revokeObjectURL(url);
  }
  function releaseAll() { for (const url of Array.from(active)) release(url); }
  global.addEventListener('pagehide', releaseAll);
  global.HLAudio = Object.freeze({ prepare, release, releaseAll, CHUNK_BYTES, MAX_BYTES });
})(window);
