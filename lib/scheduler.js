/**
 * Tabbit CDP - 定时任务与批量执行模块
 * 延迟执行、定时轮询、批量任务队列
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class Scheduler {
  constructor(tabbitClient) {
    this.client = tabbitClient;
    this._tasks = [];
    this._running = false;
    this._results = [];
  }

  /**
   * 添加单次任务
   * @param {object} task
   * @param {string} task.name - 任务名
   * @param {Function} task.execute - 执行函数 (async)
   * @param {number} task.delay - 延迟执行 ms
   */
  addTask(task) {
    this._tasks.push({
      id: this._tasks.length + 1,
      name: task.name || `task-${this._tasks.length + 1}`,
      execute: task.execute,
      delay: task.delay || 0,
      status: 'pending',
      result: null,
      error: null,
    });
    return this;
  }

  /**
   * 添加批量对话任务
   * @param {Array<string>} messages - 消息列表
   * @param {object} options
   * @param {number} options.interval - 每条消息间隔 ms
   * @param {Function} options.onResult - 结果回调
   */
  addBatchChat(messages, options = {}) {
    const { interval = 2000, onResult } = options;

    messages.forEach((msg, i) => {
      this.addTask({
        name: `chat-${i + 1}`,
        delay: i * interval,
        execute: async () => {
          const result = await this.client.chat(msg);
          if (onResult) onResult(result);
          return result;
        },
      });
    });

    return this;
  }

  /**
   * 添加定时轮询任务
   * @param {string} name - 任务名
   * @param {Function} checkFn - 检查函数 (返回 true 停止)
   * @param {object} options
   * @param {number} options.interval - 轮询间隔 ms
   * @param {number} options.maxAttempts - 最大尝试次数
   */
  addPolling(name, checkFn, options = {}) {
    const { interval = 3000, maxAttempts = 20 } = options;

    this.addTask({
      name,
      execute: async () => {
        for (let i = 0; i < maxAttempts; i++) {
          const shouldStop = await checkFn(i);
          if (shouldStop) return { stopped: true, attempt: i + 1 };
          await sleep(interval);
        }
        return { stopped: false, attempt: maxAttempts };
      },
    });

    return this;
  }

  /**
   * 添加延迟任务
   */
  addDelayed(name, execute, delayMs) {
    return this.addTask({ name, execute, delay: delayMs });
  }

  /**
   * 添加重试任务
   */
  addWithRetry(name, executeFn, options = {}) {
    const { maxRetries = 3, retryDelay = 1000 } = options;

    return this.addTask({
      name,
      execute: async () => {
        let lastError;
        for (let i = 0; i <= maxRetries; i++) {
          try {
            return await executeFn();
          } catch (e) {
            lastError = e;
            if (i < maxRetries) await sleep(retryDelay);
          }
        }
        throw lastError;
      },
    });
  }

  /** 执行所有任务（顺序执行） */
  async run() {
    this._running = true;
    this._results = [];

    for (const task of this._tasks) {
      if (!this._running) break;

      task.status = 'running';
      if (task.delay > 0) await sleep(task.delay);

      try {
        task.result = await task.execute();
        task.status = 'completed';
        this._results.push({ name: task.name, status: 'completed', result: task.result });
      } catch (e) {
        task.error = e.message;
        task.status = 'failed';
        this._results.push({ name: task.name, status: 'failed', error: e.message });
      }
    }

    this._running = false;
    return this._results;
  }

  /** 并行执行所有任务 */
  async runParallel(concurrency = 3) {
    this._running = true;
    this._results = [];

    const chunks = [];
    for (let i = 0; i < this._tasks.length; i += concurrency) {
      chunks.push(this._tasks.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      if (!this._running) break;

      const promises = chunk.map(async (task) => {
        task.status = 'running';
        if (task.delay > 0) await sleep(task.delay);

        try {
          task.result = await task.execute();
          task.status = 'completed';
          return { name: task.name, status: 'completed', result: task.result };
        } catch (e) {
          task.error = e.message;
          task.status = 'failed';
          return { name: task.name, status: 'failed', error: e.message };
        }
      });

      const results = await Promise.all(promises);
      this._results.push(...results);
    }

    this._running = false;
    return this._results;
  }

  /** 停止执行 */
  stop() {
    this._running = false;
  }

  /** 获取任务状态 */
  getStatus() {
    return {
      total: this._tasks.length,
      pending: this._tasks.filter(t => t.status === 'pending').length,
      running: this._tasks.filter(t => t.status === 'running').length,
      completed: this._tasks.filter(t => t.status === 'completed').length,
      failed: this._tasks.filter(t => t.status === 'failed').length,
      results: this._results,
    };
  }

  /** 清空任务队列 */
  clear() {
    this._tasks = [];
    this._results = [];
  }
}

module.exports = { Scheduler };
