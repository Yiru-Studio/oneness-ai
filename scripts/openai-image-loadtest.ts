type ApiTask = {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'RETRYING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  error?: string | null;
  retryCount?: number;
  nextRetryAt?: string | null;
  outputAssets?: Array<{ id: string }>;
};

const baseUrl = process.env.LOADTEST_API_BASE_URL ?? 'http://localhost:4000';
const token = process.env.LOADTEST_AUTH_TOKEN ?? 'test_token';
const projectId = mustEnv('LOADTEST_PROJECT_ID');
const total = Number(process.env.LOADTEST_TOTAL ?? 50);
const submitConcurrency = Number(process.env.LOADTEST_CONCURRENCY ?? 10);
const provider = process.env.LOADTEST_PROVIDER ?? 'openai';
const model = process.env.LOADTEST_IMAGE_MODEL ?? process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
const pollIntervalMs = Number(process.env.LOADTEST_POLL_INTERVAL_MS ?? 5000);
const timeoutMs = Number(process.env.LOADTEST_TIMEOUT_MS ?? 60 * 60 * 1000);

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${init.method ?? 'GET'} ${path} failed: HTTP ${res.status} ${text}`);
  }
  return await res.json() as T;
}

async function createTask(index: number): Promise<ApiTask> {
  return await apiFetch<ApiTask>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      type: 'IMAGE',
      projectId,
      provider,
      input: {
        prompt: `Production load test resource image ${index + 1}. Single clean prop on neutral background, stable lighting.`,
        ratio: '1:1',
        model,
        n: 1,
      },
    }),
  });
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function terminal(task: ApiTask): boolean {
  return task.status === 'SUCCEEDED' || task.status === 'FAILED' || task.status === 'CANCELLED';
}

function transientErrorCount(tasks: ApiTask[]): number {
  return tasks.filter((task) =>
    /http_5\d\d|upstream_error|rate_limit|http_429|timeout|network|fetch failed/i.test(
      task.error ?? '',
    ),
  ).length;
}

async function main() {
  const startedAt = Date.now();
  const indexes = Array.from({ length: total }, (_, index) => index);
  const created = await mapLimit(indexes, submitConcurrency, createTask);
  const taskIds = created.map((task) => task.id);
  const firstSeen = new Map(taskIds.map((id) => [id, Date.now()]));
  const completedAt = new Map<string, number>();
  let latest = created;

  while (Date.now() - startedAt < timeoutMs) {
    latest = await mapLimit(taskIds, submitConcurrency, (id) => apiFetch<ApiTask>(`/api/tasks/${id}`));
    for (const task of latest) {
      if (terminal(task) && !completedAt.has(task.id)) completedAt.set(task.id, Date.now());
    }

    const succeeded = latest.filter((task) => task.status === 'SUCCEEDED').length;
    const failed = latest.filter((task) => task.status === 'FAILED').length;
    const cancelled = latest.filter((task) => task.status === 'CANCELLED').length;
    const retrying = latest.filter((task) => task.status === 'RETRYING').length;
    const running = latest.filter((task) => task.status === 'RUNNING').length;
    const queued = latest.filter((task) => task.status === 'QUEUED').length;
    process.stdout.write(
      JSON.stringify({ total, succeeded, failed, cancelled, retrying, running, queued }) + '\n',
    );

    if (latest.every(terminal)) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const durations = latest
    .filter((task) => task.status === 'SUCCEEDED')
    .map((task) => (completedAt.get(task.id) ?? Date.now()) - (firstSeen.get(task.id) ?? startedAt))
    .sort((a, b) => a - b);
  const avgMs =
    durations.length === 0
      ? null
      : Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length);
  const p95Ms =
    durations.length === 0
      ? null
      : durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))];

  const report = {
    total,
    submitConcurrency,
    provider,
    model,
    succeeded: latest.filter((task) => task.status === 'SUCCEEDED').length,
    retrying: latest.filter((task) => task.status === 'RETRYING').length,
    failed: latest.filter((task) => task.status === 'FAILED').length,
    cancelled: latest.filter((task) => task.status === 'CANCELLED').length,
    transientOpenAIErrors: transientErrorCount(latest),
    avgMs,
    p95Ms,
    tasks: latest.map((task) => ({
      id: task.id,
      status: task.status,
      retryCount: task.retryCount ?? 0,
      nextRetryAt: task.nextRetryAt ?? null,
      error: task.error ?? null,
    })),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
