import { CAP_ERROR_CODES } from "./constants.js";

/** 创建携带稳定错误码的插件异常。 */
export class CapPluginError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "CapPluginError";
    this.code = code || CAP_ERROR_CODES.SOLVE_FAILED;
    if (cause !== undefined) this.cause = cause;
  }
}

/** 将宿主或平台抛出的任意值收敛为不泄露敏感数据的插件异常。 */
export function normalizeCapError(error, fallbackCode, fallbackMessage) {
  if (error instanceof CapPluginError) return error;
  return new CapPluginError(
    fallbackCode || CAP_ERROR_CODES.SOLVE_FAILED,
    fallbackMessage || "安全验证失败，请稍后重试",
    error
  );
}

/** 判断异常是否由显式取消触发。 */
export function isCancelledError(error) {
  return Boolean(error && error.code === CAP_ERROR_CODES.CANCELLED);
}
