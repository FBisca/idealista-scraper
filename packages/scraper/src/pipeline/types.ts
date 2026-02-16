type ProgressEntry<T> = {
  id: string;
  timestamp: number;
  data: T;
};

type CrawlStateSnapshot = {
  sourceUrl: string;
  discoveredIds: string[];
  completedIds: string[];
  failedIds: string[];
  lastListPage: number;
  startedAt: number;
  updatedAt: number;
};

export type { ProgressEntry, CrawlStateSnapshot };
