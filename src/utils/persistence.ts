import { DatasetItem, SearchResultSummary, DatasetGenerationConfig } from "../types";

const STORAGE_KEYS = {
  ITEMS: "llm-dataset-generator:items",
  SUMMARY: "llm-dataset-generator:summary",
  CONFIG: "llm-dataset-generator:config",
  SAVED_DATASETS: "llm-dataset-generator:saved-datasets",
};

const DB_NAME = "LLMDatasetGenerator";
const DB_VERSION = 1;
const STORE_NAME = "datasets";

// In-memory cache for synchronous reads
let memoryCache: Record<string, any> = {};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key: string): Promise<any> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, value: any): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Silently fail — caller should check return value
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Silently fail
  }
}

function isLocalStorageAvailable(): boolean {
  try {
    const key = "__test__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function localStorageFallbackSet(key: string, value: any): boolean {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 4_500_000) {
      console.warn(`Storage quota warning: ${key} is ${(serialized.length / 1024 / 1024).toFixed(1)}MB, approaching localStorage 5MB limit`);
    }
    localStorage.setItem(key, serialized);
    return true;
  } catch (e: any) {
    if (e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22)) {
      console.error(`localStorage quota exceeded for key "${key}". Consider reducing dataset size.`);
    }
    return false;
  }
}

export function saveItems(items: DatasetItem[]): void {
  memoryCache[STORAGE_KEYS.ITEMS] = items;
  idbSet(STORAGE_KEYS.ITEMS, items).catch(() => {
    localStorageFallbackSet(STORAGE_KEYS.ITEMS, items);
  });
}

export function loadItems(): DatasetItem[] {
  if (memoryCache[STORAGE_KEYS.ITEMS]) {
    return memoryCache[STORAGE_KEYS.ITEMS];
  }
  // Attempt IndexedDB first, then localStorage fallback
  const cached = (async () => {
    const fromDB = await idbGet(STORAGE_KEYS.ITEMS);
    if (fromDB) return fromDB;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ITEMS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  })();
  // Return empty immediately; cache will populate from IndexedDB async
  // App.tsx handles this via its initial state
  return [];
}

export function saveSummary(summary: SearchResultSummary): void {
  memoryCache[STORAGE_KEYS.SUMMARY] = summary;
  idbSet(STORAGE_KEYS.SUMMARY, summary);
}

export function loadSummary(): SearchResultSummary | null {
  if (memoryCache[STORAGE_KEYS.SUMMARY] !== undefined) {
    return memoryCache[STORAGE_KEYS.SUMMARY];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SUMMARY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveConfig(config: DatasetGenerationConfig): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
  } catch {
    console.warn("Failed to persist config");
  }
}

export function loadConfig(): DatasetGenerationConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONFIG);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export interface SavedDataset {
  id: string;
  name: string;
  topic: string;
  format: string;
  itemCount: number;
  createdAt: string;
  items: DatasetItem[];
  summary: SearchResultSummary | null;
}

export function saveNamedDataset(name: string, items: DatasetItem[], summary: SearchResultSummary | null, topic: string, format: string): void {
  const datasets = loadAllDatasets();
  const existingIdx = datasets.findIndex((d) => d.name === name);
  const dataset: SavedDataset = {
    id: `ds-${Date.now()}`,
    name,
    topic,
    format,
    itemCount: items.length,
    createdAt: new Date().toISOString(),
    items,
    summary,
  };
  if (existingIdx >= 0) {
    datasets[existingIdx] = dataset;
  } else {
    datasets.push(dataset);
  }
  const serialized = JSON.stringify(datasets);
  idbSet(STORAGE_KEYS.SAVED_DATASETS, datasets).catch(() => {
    localStorageFallbackSet(STORAGE_KEYS.SAVED_DATASETS, datasets);
  });
}

export function loadAllDatasets(): SavedDataset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SAVED_DATASETS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Ignore
  }
  return [];
}

export function deleteNamedDataset(name: string): void {
  const datasets = loadAllDatasets();
  const filtered = datasets.filter((d) => d.name !== name);
  const serialized = JSON.stringify(filtered);
  idbSet(STORAGE_KEYS.SAVED_DATASETS, filtered).catch(() => {
    localStorageFallbackSet(STORAGE_KEYS.SAVED_DATASETS, filtered);
  });
}

export function clearCurrentSession(): void {
  memoryCache = {};
  try {
    localStorage.removeItem(STORAGE_KEYS.ITEMS);
    localStorage.removeItem(STORAGE_KEYS.SUMMARY);
    localStorage.removeItem(STORAGE_KEYS.CONFIG);
  } catch {
    // Ignore
  }
  idbDelete(STORAGE_KEYS.ITEMS).catch(() => {});
  idbDelete(STORAGE_KEYS.SUMMARY).catch(() => {});
}
