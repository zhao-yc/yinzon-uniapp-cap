import { CAP_ERROR_CODES } from "../constants.js";
import { CapPluginError } from "../errors.js";
import { hashMatchesTarget, sha256Bytes } from "../sha256.js";

function yieldToHost() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 百度小程序没有统一可用的 Worker/WASM 组合，按约 16ms 时间片求解并主动让出主线程。
 */
export async function solveChallengeChunked([salt, target], options = {}) {
  const signal = options.signal;
  const sliceMs = Math.max(4, Math.min(32, Number(options.sliceMs) || 16));
  let nonce = 0;
  while (nonce < Number.MAX_SAFE_INTEGER) {
    signal?.throwIfCancelled();
    const deadline = Date.now() + sliceMs;
    do {
      if (hashMatchesTarget(sha256Bytes(`${salt}${nonce}`), target)) return nonce;
      nonce += 1;
    } while (Date.now() < deadline);
    await yieldToHost();
  }
  throw new CapPluginError(CAP_ERROR_CODES.SOLVE_FAILED, "安全验证计算失败，请重试");
}

/** 顺序求解可控制百度低端机峰值占用，并持续报告整体进度。 */
export async function solveBaiduChallenges(challenges, options = {}) {
  const results = [];
  for (let index = 0; index < challenges.length; index += 1) {
    options.signal?.throwIfCancelled();
    const nonce = await solveChallengeChunked(challenges[index], options);
    results.push(nonce);
    options.onProgress?.(Math.min(99, Math.round(((index + 1) / challenges.length) * 100)));
  }
  return results;
}
