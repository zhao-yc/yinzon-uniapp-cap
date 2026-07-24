import assert from "node:assert/strict";
import test from "node:test";

import {
  CAP_ERROR_CODES,
  bytesToHex,
  capPrng,
  deriveChallenges,
  hashMatchesTarget,
  normalizeMiniChallengeResponse,
  normalizeVerificationResult,
  sha256Bytes,
  solveChallengeChunked
} from "../js_sdk/index.js";

function futureIso(milliseconds = 60000) {
  return new Date(Date.now() + milliseconds).toISOString();
}

test("SHA-256 与标准向量一致", () => {
  assert.equal(bytesToHex(sha256Bytes("")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(bytesToHex(sha256Bytes("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(bytesToHex(sha256Bytes("中文")), "72726d8818f693066ceb69afa364218b692e62ea92b385782363780f47529c21");
});

test("目标比较支持奇数 nibble", () => {
  const hash = sha256Bytes("abc");
  assert.equal(hashMatchesTarget(hash, "ba7"), true);
  assert.equal(hashMatchesTarget(hash, "ba8"), false);
});

test("挑战派生与 cap-widget 0.1.50 的 1-based 规则一致", () => {
  assert.equal(capPrng("token1", 32), "8539570754e5fd8b81c9ec01357bd685");
  assert.deepEqual(deriveChallenges("token", { c: 2, s: 8, d: 2 }), [
    ["85395707", "4b"],
    ["d54df4b5", "28"]
  ]);
});

test("小程序 challenge 只接受严格 cap-pow-v1 白名单", () => {
  const expiresAt = futureIso();
  const normalized = normalizeMiniChallengeResponse({
    clientSessionId: "session-1",
    protocol: "cap-pow-v1",
    challenges: [["salt", "0"]],
    expiresAt
  });
  assert.equal(normalized.clientSessionId, "session-1");
  assert.equal(normalized.protocol, "cap-pow-v1");
  assert.deepEqual(normalized.challenges, [["salt", "0"]]);
  assert.equal(normalized.expiresAt, expiresAt);

  for (const extra of [
    { instrumentation: false },
    { rsw: false },
    { format: "other" },
    { token: "upstream-token" }
  ]) {
    assert.throws(
      () => normalizeMiniChallengeResponse({
        clientSessionId: "session-1",
        protocol: "cap-pow-v1",
        challenges: [["salt", "0"]],
        expiresAt,
        ...extra
      }),
      (error) => error.code === CAP_ERROR_CODES.UNSUPPORTED_CHALLENGE
    );
  }
});

test("未知协议、过期挑战与缺失有效期均失败关闭", () => {
  const base = {
    clientSessionId: "session-1",
    protocol: "cap-pow-v1",
    challenges: [["salt", "0"]],
    expiresAt: futureIso()
  };
  assert.throws(
    () => normalizeMiniChallengeResponse({ ...base, protocol: "cap-pow-v2" }),
    (error) => error.code === CAP_ERROR_CODES.UNSUPPORTED_CHALLENGE
  );
  assert.throws(() => normalizeMiniChallengeResponse({ ...base, expiresAt: null }));
  assert.throws(() => normalizeMiniChallengeResponse({ ...base, expiresAt: new Date(Date.now() - 1000).toISOString() }));
});

test("最终票据必须包含未来有效期", () => {
  const expiresAt = futureIso();
  assert.deepEqual(normalizeVerificationResult({ captchaVerification: "mpcap1_ticket", platform: "wechat", expiresAt }, "wechat"), {
    captchaVerification: "mpcap1_ticket",
    platform: "wechat",
    expiresAt
  });
  assert.throws(() => normalizeVerificationResult({ captchaVerification: "ticket" }, "wechat"));
  assert.throws(
    () => normalizeVerificationResult({ captchaVerification: "mpcap1_ticket", platform: "baidu", expiresAt }, "wechat"),
    (error) => error.code === CAP_ERROR_CODES.REDEEM_FAILED
  );
});

test("百度分片求解结果满足挑战", async () => {
  const nonce = await solveChallengeChunked(["salt", "0"], { sliceMs: 4 });
  assert.equal(Number.isInteger(nonce), true);
  assert.equal(hashMatchesTarget(sha256Bytes(`salt${nonce}`), "0"), true);
});
