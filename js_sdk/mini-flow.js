import { CAP_STATES } from "./constants.js";
import { normalizeMiniChallengeResponse, normalizeVerificationResult } from "./challenge.js";

/**
 * 等待可取消的外部操作。适配器既可以直接返回 Promise，也可以返回
 * `{ promise, abort }`，后者会在取消或超时时主动释放宿主网络请求。
 */
function awaitCancellableOperation(factory, signal) {
  signal.throwIfCancelled();
  const operation = factory();
  const promise = operation && typeof operation === "object" && "promise" in operation
    ? operation.promise
    : operation;
  const abort = operation && typeof operation.abort === "function"
    ? () => operation.abort()
    : () => {};

  return new Promise((resolve, reject) => {
    let settled = false;
    let removeCancel = () => {};
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      removeCancel();
      callback(value);
    };
    removeCancel = signal.onCancel((reason) => {
      try {
        abort();
      } catch (error) {
        // 适配器 abort 失败不能改变原始取消原因。
      }
      finish(reject, reason);
    });

    // 即使信号在注册监听时已经取消，也要接管底层 Promise 的后续拒绝。
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

/**
 * 执行平台凭证、挑战、求解和兑换的原子流程。
 * 每个外部 await 后都检查取消，确保取消后绝不进入 redeem。
 */
export async function runMiniVerification(options) {
  const {
    platform,
    purpose,
    binding,
    requestId,
    signal,
    getLoginCode,
    createMiniChallenge,
    solveChallenges,
    redeemMiniChallenge,
    onStage,
    onSession,
    onSensitive
  } = options;
  let loginCode = "";
  try {
    loginCode = await awaitCancellableOperation(() => getLoginCode(signal), signal);
    onSensitive?.({ loginCode, clientSessionId: "" });
    signal.throwIfCancelled();
    onStage?.(CAP_STATES.CHALLENGING, 0, "正在获取安全验证挑战…");
    const response = await awaitCancellableOperation(() => createMiniChallenge({
      platform,
      loginCode,
      purpose,
      binding,
      requestId,
      signal
    }), signal);
    loginCode = "";
    onSensitive?.({ loginCode: "", clientSessionId: "" });
    signal.throwIfCancelled();
    const challenge = normalizeMiniChallengeResponse(response);
    onSession?.(challenge.clientSessionId);
    onSensitive?.({ loginCode: "", clientSessionId: challenge.clientSessionId });
    onStage?.(CAP_STATES.SOLVING, 0, "正在计算安全验证…");
    const solutions = await awaitCancellableOperation(
      () => solveChallenges(challenge.challenges, signal),
      signal
    );
    signal.throwIfCancelled();
    onStage?.(CAP_STATES.REDEEMING, 99, "正在确认安全验证…");
    const redeemed = await awaitCancellableOperation(() => redeemMiniChallenge({
      platform,
      clientSessionId: challenge.clientSessionId,
      solutions,
      purpose,
      binding,
      requestId,
      signal
    }), signal);
    signal.throwIfCancelled();
    return normalizeVerificationResult(redeemed, platform);
  } finally {
    loginCode = "";
    onSensitive?.({ loginCode: "", clientSessionId: "" });
  }
}
