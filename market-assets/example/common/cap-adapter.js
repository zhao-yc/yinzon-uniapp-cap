const ERROR_CODE = "CAP_BACKEND_NOT_CONFIGURED";
const ERROR_MESSAGE =
  "示例尚未配置宿主后端，请先实现 capAdapter 后再发起安全验证。";

/**
 * 创建统一的未配置错误，确保示例不会伪造验证成功。
 */
export function createBackendNotConfiguredError(method = "") {
  const suffix = method ? `（${method}）` : "";
  const error = new Error(`${ERROR_MESSAGE}${suffix}`);
  error.code = ERROR_CODE;
  return error;
}

/**
 * 示例默认关闭真实验证。接入者完成三个方法后，再改为 true。
 */
export const CAP_BACKEND_CONFIGURED = false;

/**
 * 仅展示插件要求的适配器形状，不包含域名、AppID、site key 或 secret。
 */
export const capAdapter = Object.freeze({
  async loadWebConfig() {
    throw createBackendNotConfiguredError("loadWebConfig");
  },

  async createMiniChallenge() {
    throw createBackendNotConfiguredError("createMiniChallenge");
  },

  async redeemMiniChallenge() {
    throw createBackendNotConfiguredError("redeemMiniChallenge");
  }
});
