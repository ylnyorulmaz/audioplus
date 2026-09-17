import { MDX_INST_HQ3 } from './mdx-profile.js';

const DB_NAME = 'audio-plus-ai';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const MODEL_KEY = MDX_INST_HQ3.id;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open Audio+ AI model storage.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Audio+ AI model storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Audio+ AI model storage transaction aborted.'));
  });
}

export async function installLiveAiModel(buffer, { fileName, size, sha256 } = {}) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) throw new Error('Model bytes are empty.');
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
      id: MODEL_KEY,
      displayName: MDX_INST_HQ3.displayName,
      fileName: fileName ?? MDX_INST_HQ3.fileName,
      size: Number(size) || buffer.byteLength,
      sha256: sha256 ?? MDX_INST_HQ3.sha256,
      installedAt: Date.now(),
      bytes: buffer.slice(0)
    });
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function getInstalledLiveAiModel({ includeBytes = true } = {}) {
  const db = await openDb();
  try {
    const record = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(MODEL_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('Could not read installed AI model.'));
    });
    if (!record) return null;
    if (includeBytes) return record;
    const { bytes, ...metadata } = record;
    return metadata;
  } finally {
    db.close();
  }
}

export async function removeInstalledLiveAiModel() {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(MODEL_KEY);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

function packagedModelUrlCandidates(explicitUrl = null) {
  const urls = [];
  if (typeof explicitUrl === 'string' && explicitUrl) urls.push(explicitUrl);
  // Dedicated workers do not declare `chrome`; use globalThis so optional chaining is safe.
  const extensionGetUrl = globalThis.chrome?.runtime?.getURL;
  if (typeof extensionGetUrl === 'function') {
    try { urls.push(extensionGetUrl.call(globalThis.chrome.runtime, MDX_INST_HQ3.fileName)); } catch {}
  }
  const href = globalThis.location?.href;
  if (href) {
    try { urls.push(new URL(MDX_INST_HQ3.fileName, href).href); } catch {}
    try { urls.push(new URL(`../${MDX_INST_HQ3.fileName}`, href).href); } catch {}
  }
  return [...new Set(urls)];
}

function assertModelByteLength(byteLength, source) {
  const expected = MDX_INST_HQ3.expectedByteLength;
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    throw new Error(`${MDX_INST_HQ3.fileName} from ${source} is empty.`);
  }
  if (byteLength !== expected) {
    throw new Error(
      `${MDX_INST_HQ3.fileName} from ${source} is ${byteLength} bytes, expected ${expected}. ` +
      'A Range/cache probe may have truncated the file — reload Audio+ and try again.'
    );
  }
}

function fetchArrayBufferNoStore(url) {
  // XHR + no-store avoids Chrome caching a prior Range probe as the full model body.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.setRequestHeader('Cache-Control', 'no-cache');
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 0) resolve(xhr.response);
      else reject(new Error(`HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Network error while reading the packaged AI model.'));
    xhr.ontimeout = () => reject(new Error('Timed out while reading the packaged AI model.'));
    xhr.timeout = 300000;
    xhr.send();
  });
}

export async function fetchPackagedModelBuffer(explicitUrl = null) {
  const errors = [];
  for (const url of packagedModelUrlCandidates(explicitUrl)) {
    try {
      const buffer = await fetchArrayBufferNoStore(url);
      if (buffer?.byteLength) {
        assertModelByteLength(buffer.byteLength, url);
        return buffer;
      }
      errors.push(`${url} → empty body`);
    } catch (error) {
      errors.push(`${url} → ${error?.message ?? error}`);
    }
  }
  if (errors.length) {
    console.warn('[Audio+] packaged model fetch failed', errors);
  }
  return null;
}

/** Load the packaged ONNX from the extension package in a page/offscreen context. */
export async function loadPackagedModelBytes() {
  const extensionGetUrl = globalThis.chrome?.runtime?.getURL;
  if (typeof extensionGetUrl !== 'function') {
    throw new Error('chrome.runtime.getURL is unavailable for the packaged AI model.');
  }
  const url = extensionGetUrl.call(globalThis.chrome.runtime, MDX_INST_HQ3.fileName);

  let buffer;
  try {
    buffer = await fetchArrayBufferNoStore(url);
  } catch (error) {
    throw new Error(`Could not read ${MDX_INST_HQ3.fileName} from the Audio+ folder (${error?.message ?? error}).`);
  }
  assertModelByteLength(buffer?.byteLength ?? 0, 'extension folder');
  return buffer;
}

export function coerceModelBytes(value) {
  if (value instanceof ArrayBuffer && value.byteLength > 0) return value;
  if (ArrayBuffer.isView(value) && value.byteLength > 0) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}
