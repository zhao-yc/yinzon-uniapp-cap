import { CAP_ERROR_CODES, CAP_PROTOCOL } from "./constants.js";
import { CapPluginError } from "./errors.js";

/** 将超时限制收敛到安全范围，避免宿主意外制造永久等待。 */
export function normalizeTimeoutMs(value, fallback = CAP_PROTOCOL.DEFAULT_TIMEOUT_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(CAP_PROTOCOL.MAX_TIMEOUT_MS, Math.max(CAP_PROTOCOL.MIN_TIMEOUT_MS, Math.round(parsed)));
}

/** 创建不依赖 AbortController 的轻量取消信号，兼容各小程序运行时。 */
export function createTaskSignal() {
  const listeners = new Set();
  const signal = {
    cancelled: false,
    reason: null,
    onCancel(listener) {
      if (typeof listener !== "function") return () => {};
      if (signal.cancelled) {
        listener(signal.reason);
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    throwIfCancelled() {
      if (signal.cancelled) {
        throw signal.reason || new CapPluginError(CAP_ERROR_CODES.CANCELLED, "已取消安全验证");
      }
    }
  };

  return {
    signal,
    cancel(reason) {
      if (signal.cancelled) return;
      signal.cancelled = true;
      signal.reason = reason || new CapPluginError(CAP_ERROR_CODES.CANCELLED, "已取消安全验证");
      for (const listener of [...listeners]) {
        try {
          listener(signal.reason);
        } catch (error) {
          // 取消清理失败不能阻断其他清理器。
        }
      }
      listeners.clear();
    }
  };
}

/** 统一管理 30 秒超时与取消，定时器一定会在任务结束时释放。 */
export function raceTask(promise, { signal, timeoutMs }) {
  const normalizedTimeout = normalizeTimeoutMs(timeoutMs);
  return new Promise((resolve, reject) => {
    let settled = false;
    let removeCancel = () => {};
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeCancel();
      callback(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new CapPluginError(CAP_ERROR_CODES.TIMEOUT, "安全验证超时，请重试"));
    }, normalizedTimeout);
    removeCancel = signal
      ? signal.onCancel((reason) => finish(reject, reason))
      : () => {};
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

/** 单任务门闩：同一组件不允许并发验证。 */
export class SingleFlightGate {
  constructor() {
    this.current = null;
  }

  begin(meta = {}) {
    if (this.current) {
      throw new CapPluginError(CAP_ERROR_CODES.BUSY, "安全验证正在进行，请勿重复提交");
    }
    const controller = createTaskSignal();
    this.current = { ...meta, controller };
    return this.current;
  }

  cancel(reason) {
    if (!this.current) return false;
    this.current.controller.cancel(reason);
    return true;
  }

  finish(task) {
    if (this.current === task) this.current = null;
  }

  reset() {
    this.cancel();
    this.current = null;
  }
}
