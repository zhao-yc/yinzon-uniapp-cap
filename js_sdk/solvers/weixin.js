import { CAP_ERROR_CODES } from "../constants.js";
import { CapPluginError } from "../errors.js";
import { solveBaiduChallenges } from "./baidu.js";

export const DEFAULT_WEIXIN_WORKER_PATH = "uni_modules/yinzon-uniapp-cap/static/yinzon-uniapp-cap/weixin-worker.js";
export const DEFAULT_WEIXIN_WASM_PATH = "uni_modules/yinzon-uniapp-cap/static/yinzon-uniapp-cap/cap_wasm_bg.wasm";

/** 微信默认严格使用单 Worker + WXWebAssembly；仅显式 allowJsFallback=true 才允许测试回退。 */
export async function solveWeixinChallenges(challenges, options = {}) {
  const wxApi = options.wxApi || (typeof wx !== "undefined" ? wx : null);
  if (!wxApi || typeof wxApi.createWorker !== "function") {
    if (options.allowJsFallback !== true) {
      throw new CapPluginError(CAP_ERROR_CODES.SOLVE_FAILED, "当前微信版本不支持安全验证 Worker");
    }
    return solveBaiduChallenges(challenges, options);
  }

  let worker;
  try {
    worker = wxApi.createWorker(options.workerPath || DEFAULT_WEIXIN_WORKER_PATH, {
      useExperimentalWorker: true
    });
  } catch (error) {
    if (options.allowJsFallback !== true) {
      throw new CapPluginError(CAP_ERROR_CODES.SOLVE_FAILED, "安全验证 Worker 启动失败", error);
    }
    return solveBaiduChallenges(challenges, options);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      try {
        worker.terminate();
      } catch (error) {
        // Worker 已退出时重复 terminate 是安全的。
      }
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      removeCancel();
      cleanup();
      callback(value);
    };
    // 已取消信号会同步执行监听器，因此必须先初始化清理函数，避免 TDZ 和 Worker 泄漏。
    let removeCancel = () => {};
    removeCancel = options.signal?.onCancel((reason) => finish(reject, reason)) || (() => {});
    if (settled) return;

    worker.onMessage((message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "progress") {
        options.onProgress?.(Math.max(0, Math.min(99, Number(message.progress) || 0)));
        return;
      }
      if (message.type === "result") {
        finish(resolve, Array.isArray(message.solutions) ? message.solutions : []);
        return;
      }
      if (message.type === "error") {
        finish(reject, new CapPluginError(CAP_ERROR_CODES.SOLVE_FAILED, "安全验证计算失败，请重试"));
      }
    });
    if (typeof worker.onError === "function") {
      worker.onError(() => finish(reject, new CapPluginError(CAP_ERROR_CODES.SOLVE_FAILED, "安全验证 Worker 异常")));
    }

    try {
      worker.postMessage({
        type: "solve",
        challenges,
        wasmPath: options.wasmPath || DEFAULT_WEIXIN_WASM_PATH
      });
    } catch (error) {
      finish(reject, new CapPluginError(CAP_ERROR_CODES.SOLVE_FAILED, "安全验证 Worker 通信失败", error));
    }
  });
}
