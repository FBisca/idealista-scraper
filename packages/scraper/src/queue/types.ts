type RequestState = 'pending' | 'in-progress' | 'handled' | 'failed';

type QueueEntry = {
  url: string;
  uniqueKey: string;
  label?: string;
  state: RequestState;
  retryCount: number;
  userData?: Record<string, unknown>;
  errors: string[];
};

type QueueOptions = {
  persistPath?: string;
  resume?: boolean;
};

export type { RequestState, QueueEntry, QueueOptions };
