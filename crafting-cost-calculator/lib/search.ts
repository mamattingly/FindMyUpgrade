import Fuse from "fuse.js";

export type Searchable = { id: number; name: string; kind?: string; profession?: string };
const fuseOptions = {
  keys: ["name"],
  threshold: 0.38,
  ignoreLocation: true,
  minMatchCharLength: 2,
  includeScore: true,
  shouldSort: true,
};

export function rankSearchResults<T extends Searchable>(items: T[], rawQuery: string, limit = 50): T[] {
  const query = rawQuery.trim();
  if (!query || limit <= 0) return [];
  if (/^\\d+$/.test(query)) {
    const exact = items.filter(item => String(item.id) === query);
    if (exact.length) return exact.slice(0, limit);
  }
  const unique = new Map<string, T>();
  for (const item of items) unique.set(`${item.kind || "item"}:${item.id}`, item);
  return new Fuse([...unique.values()], fuseOptions).search(query, { limit }).map(result => result.item);
}

export function mergeSearchResults<T extends Searchable>(...groups: T[][]): T[] {
  const unique = new Map<string, T>();
  for (const group of groups) for (const item of group) unique.set(`${item.kind || "item"}:${item.id}`, item);
  return [...unique.values()];
}
