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
