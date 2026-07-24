import { CAP_ERROR_CODES, CAP_PROTOCOL } from "./constants.js";
import { CapPluginError } from "./errors.js";

/** Cap 官方挑战派生所使用的 FNV-1a + xorshift32 伪随机算法。 */
export function capPrng(seed, length) {
  const normalizedLength = Number(length);
  if (!Number.isInteger(normalizedLength) || normalizedLength < 1 || normalizedLength > CAP_PROTOCOL.MAX_SALT_LENGTH) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, "安全验证挑战长度无效");
  }

  let state = 2166136261;
  const input = String(seed);
  for (let index = 0; index < input.length; index += 1) {
    state ^= input.charCodeAt(index);
    state += (state << 1) + (state << 4) + (state << 7) + (state << 8) + (state << 24);
  }
  state >>>= 0;

  let result = "";
  while (result.length < normalizedLength) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    result += state.toString(16).padStart(8, "0");
  }
  return result.slice(0, normalizedLength);
}

function validateChallengePair(pair) {
  if (!Array.isArray(pair) || pair.length !== 2) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, "安全验证挑战格式无效");
  }
  const salt = String(pair[0] || "");
  const target = String(pair[1] || "").toLowerCase();
  if (!salt || salt.length > CAP_PROTOCOL.MAX_SALT_LENGTH) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, "安全验证盐值无效");
  }
  if (!/^[0-9a-f]+$/.test(target) || target.length > CAP_PROTOCOL.MAX_TARGET_LENGTH) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, "安全验证目标值无效");
  }
  return [salt, target];
}

/** 按 Cap 0.1.50 的 1-based 计数规则展开压缩挑战。 */
export function deriveChallenges(token, challenge) {
  const normalizedToken = String(token || "");
  if (!normalizedToken) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, "安全验证令牌缺失");
  }

  if (Array.isArray(challenge)) {
    if (!challenge.length || challenge.length > CAP_PROTOCOL.MAX_CHALLENGE_COUNT) {
      throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, "安全验证挑战数量无效");
    }
    return challenge.map(validateChallengePair);
  }

  if (!challenge || typeof challenge !== "object") {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, "安全验证挑战缺失");
  }
  const count = Number(challenge.c);
  const saltLength = Number(challenge.s);
  const targetLength = Number(challenge.d);
  if (!Number.isInteger(count) || count < 1 || count > CAP_PROTOCOL.MAX_CHALLENGE_COUNT) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, "安全验证挑战数量无效");
  }
  if (!Number.isInteger(saltLength) || saltLength < 1 || saltLength > CAP_PROTOCOL.MAX_SALT_LENGTH) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, "安全验证盐值长度无效");
  }
  if (!Number.isInteger(targetLength) || targetLength < 1 || targetLength > CAP_PROTOCOL.MAX_TARGET_LENGTH) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, "安全验证难度无效");
  }

  return Array.from({ length: count }, (_, zeroBasedIndex) => {
    const index = zeroBasedIndex + 1;
    return [
      capPrng(`${normalizedToken}${index}`, saltLength),
      capPrng(`${normalizedToken}${index}d`, targetLength)
    ];
  });
}

/** 验证小程序后端响应，拒绝 instrumentation、RSW 和未知算法。 */
export function normalizeMiniChallengeResponse(response) {
  if (!response || typeof response !== "object") {
    throw new CapPluginError(CAP_ERROR_CODES.CHALLENGE_FAILED, "安全验证服务响应无效");
  }
  const allowedFields = new Set(["clientSessionId", "protocol", "challenges", "expiresAt"]);
  const unknownFields = Object.keys(response).filter((field) => !allowedFields.has(field));
  if (unknownFields.length) {
    const includesInstrumentation = unknownFields.includes("instrumentation");
    throw new CapPluginError(
      CAP_ERROR_CODES.UNSUPPORTED_CHALLENGE,
      includesInstrumentation ? "小程序不支持浏览器环境挑战，请联系管理员" : "不支持的安全验证协议"
    );
  }
  const protocol = String(response.protocol || "");
  if (protocol !== "cap-pow-v1") {
    throw new CapPluginError(CAP_ERROR_CODES.UNSUPPORTED_CHALLENGE, "不支持的安全验证协议");
  }
  const clientSessionId = String(response.clientSessionId || "");
  if (!clientSessionId) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, "安全验证会话信息缺失");
  }
  return {
    clientSessionId,
    protocol,
    expiresAt: normalizeFutureExpiresAt(response.expiresAt, "安全验证挑战已过期"),
    challenges: deriveExplicitChallenges(response.challenges)
  };
}

/** 后端只下发已展开挑战，绝不把上游 Cap token 暴露给小程序。 */
export function deriveExplicitChallenges(challenges) {
  if (!Array.isArray(challenges) || !challenges.length || challenges.length > CAP_PROTOCOL.MAX_CHALLENGE_COUNT) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, "安全验证挑战数量无效");
  }
  return challenges.map(validateChallengePair);
}

/** 统一最终票据结构，业务只需要持久化 captchaVerification。 */
export function normalizeVerificationResult(response, platform) {
  const captchaVerification = String(response && response.captchaVerification || "");
  if (!captchaVerification) {
    throw new CapPluginError(CAP_ERROR_CODES.REDEEM_FAILED, "安全验证兑换失败，请重试");
  }
  const responsePlatform = String(response && response.platform || "");
  if (responsePlatform && responsePlatform !== platform) {
    throw new CapPluginError(CAP_ERROR_CODES.REDEEM_FAILED, "安全验证平台不匹配，请重试");
  }
  return {
    captchaVerification,
    platform,
    expiresAt: normalizeFutureExpiresAt(response.expiresAt, "安全验证票据已过期")
  };
}

/** 所有公开结果必须携带未来有效期，禁止宿主误用无期限票据。 */
export function normalizeFutureExpiresAt(value, message = "安全验证有效期无效") {
  const timestamp = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_CHALLENGE, message);
  }
  return new Date(timestamp).toISOString();
}
