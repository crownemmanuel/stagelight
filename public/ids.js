// WKWebView may omit randomUUID on a local HTTP origin.
let sequence=0;
export function uid(prefix, cryptoApi=globalThis.crypto) {
 const random=typeof cryptoApi?.randomUUID==='function'
  ? cryptoApi.randomUUID()
  : cryptoApi?.getRandomValues
   ? Array.from(cryptoApi.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('')
   : `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
 return `${prefix}-${random}`;
}
