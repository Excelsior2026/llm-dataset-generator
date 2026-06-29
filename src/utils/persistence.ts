import { DatasetItem, SearchResultSummary, DatasetGenerationConfig } from "../types";

const STORAGE_KEYS = {
  ITEMS: "llm-dataset-generator:items",
  SUMMARY: "llm-dataset-generator:summary",
  CONFIG: "llm-dataset-generator:config",
  SAVED_DATASETS: "llm-dataset-generator:saved-datasets",
};

export function saveItems(items: DatasetItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(items));
  } catch (e) {
    console.warn("Failed to persist items to localStorage:", e);
  }
}

export function loadItems(): DatasetItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ITEMS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Failed to load items from localStorage:", e);
    return [];
  }
}

export function saveSummary(summary: SearchResultSummary): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SUMMARY, JSON.stringify(summary));
  } catch (e) {
    console.warn("Failed to persist summary to localStorage:", e);
  }
}

export function loadSummary(): SearchResultSummary | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SUMMARY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Failed to load summary from localStorage:", e);
    return null;
  }
}

export function saveConfig(config: DatasetGenerationConfig): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
  } catch (e) {
    console.warn("Failed to persist config to localStorage:", e);
  }
}

export function loadConfig(): DatasetGenerationConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONFIG);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Failed to load config from localStorage:", e);
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
  try {
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
    localStorage.setItem(STORAGE_KEYS.SAVED_DATASETS, JSON.stringify(datasets));
  } catch (e) {
    console.warn("Failed to save named dataset:", e);
  }
}

export function loadAllDatasets(): SavedDataset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SAVED_DATASETS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Failed to load saved datasets:", e);
    return [];
  }
}

export function deleteNamedDataset(name: string): void {
  try {
    const datasets = loadAllDatasets();
    const filtered = datasets.filter((d) => d.name !== name);
    localStorage.setItem(STORAGE_KEYS.SAVED_DATASETS, JSON.stringify(filtered));
  } catch (e) {
    console.warn("Failed to delete dataset:", e);
  }
}

export function clearCurrentSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.ITEMS);
    localStorage.removeItem(STORAGE_KEYS.SUMMARY);
    localStorage.removeItem(STORAGE_KEYS.CONFIG);
  } catch (e) {
    console.warn("Failed to clear session data:", e);
  }
}