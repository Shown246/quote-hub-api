import {
  Queue,
  Worker,
  type QueueOptions,
  type WorkerOptions,
  type Processor,
  type ConnectionOptions,
  type JobsOptions,
} from "bullmq";
import { env } from "../../app/config/env";
import { logger } from "../logging/logger";

/**
 * Default job configuration options across all BullMQ queues in Quote-Hub.
 * Jobs retry up to 3 times with exponential backoff starting at 1000ms delay,
 * and completed jobs are pruned automatically to conserve Redis memory.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
  removeOnComplete: true,
};

let defaultConnectionFactory: (() => ConnectionOptions) | null = null;

/**
 * Overrides or resets the default Redis connection factory used for BullMQ queues and workers.
 * Primary use case is test isolation and custom mock Redis injection.
 */
export function setDefaultConnectionFactory(
  factory: (() => ConnectionOptions) | null
): void {
  defaultConnectionFactory = factory;
}

/**
 * Resolves the default Redis connection options for BullMQ.
 * Note: BullMQ strictly requires `maxRetriesPerRequest: null`.
 * In test mode (`NODE_ENV === 'test'`), it falls back to `ioredis-mock` if available
 * for headless unit testing without requiring a live Redis server.
 */
export function getDefaultConnection(): ConnectionOptions {
  if (defaultConnectionFactory) {
    return defaultConnectionFactory();
  }

  if (process.env.NODE_ENV === "test") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const RedisMock = require("ioredis-mock");
      const mock = new RedisMock({ maxRetriesPerRequest: null });
      if (mock.context?.modifiedKeyEvents) {
        mock.context.modifiedKeyEvents.setMaxListeners(100);
      }
      return mock;
    } catch {
      // Fallback if ioredis-mock is not available
    }
  }

  return {
    url: env.REDIS_URL,
    maxRetriesPerRequest: null,
  };
}

const queues = new Map<string, Queue>();
const workers = new Set<Worker>();

/**
 * Returns a cached BullMQ Queue instance for the specified queue name,
 * initializing it with default connection and retry options if not already present.
 *
 * @param queueName - Unique queue identifier (e.g., 'notifications-queue', 'media-queue')
 * @param opts - Optional QueueOptions overrides
 */
export function getQueue<DataType = any, ResultType = any, NameType extends string = string>(
  queueName: string,
  opts?: Partial<QueueOptions>
): Queue<DataType, ResultType, NameType> {
  if (queues.has(queueName)) {
    return queues.get(queueName) as Queue<DataType, ResultType, NameType>;
  }

  const connection = opts?.connection ?? getDefaultConnection();

  const queue = new Queue<DataType, ResultType, NameType>(queueName, {
    ...opts,
    connection,
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      ...opts?.defaultJobOptions,
    },
  });

  queue.on("error", (err) => {
    logger.warn({ err, queue: queueName }, "BullMQ queue connection error");
  });

  queues.set(queueName, queue as Queue);
  return queue;
}

/**
 * Creates and registers a new BullMQ Worker for processing jobs from a specific queue.
 *
 * @param queueName - Queue name to consume jobs from
 * @param processor - Async worker job handler callback
 * @param opts - Optional WorkerOptions overrides
 */
export function createWorker<
  DataType = any,
  ResultType = any,
  NameType extends string = string
>(
  queueName: string,
  processor: Processor<DataType, ResultType, NameType>,
  opts?: Partial<WorkerOptions>
): Worker<DataType, ResultType, NameType> {
  const connection = opts?.connection ?? getDefaultConnection();

  const worker = new Worker<DataType, ResultType, NameType>(queueName, processor, {
    ...opts,
    connection,
  });

  worker.on("error", (err) => {
    logger.warn({ err, queue: queueName }, "BullMQ worker connection error");
  });

  worker.on("closed", () => {
    workers.delete(worker as unknown as Worker);
  });

  workers.add(worker as unknown as Worker);
  return worker;
}

/**
 * Closes a specific named queue and removes it from the cache.
 */
export async function closeQueue(queueName: string): Promise<void> {
  const queue = queues.get(queueName);
  if (queue) {
    queues.delete(queueName);
    await queue.close();
  }
}

/**
 * Closes all active BullMQ queues and clears the queue registry.
 */
export async function closeAllQueues(): Promise<void> {
  const queueInstances = Array.from(queues.values());
  queues.clear();
  await Promise.all(queueInstances.map((q) => q.close()));
}

/**
 * Closes all registered BullMQ workers and clears the worker set.
 */
export async function closeAllWorkers(): Promise<void> {
  const workerInstances = Array.from(workers.values());
  workers.clear();
  await Promise.all(workerInstances.map((w) => w.close()));
}

/**
 * Closes all BullMQ queues and workers cleanly (used during server shutdown and test cleanup).
 */
export async function closeAll(): Promise<void> {
  await Promise.all([closeAllQueues(), closeAllWorkers()]);
}
