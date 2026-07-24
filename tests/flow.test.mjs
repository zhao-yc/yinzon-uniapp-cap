import assert from "node:assert/strict";
import test from "node:test";

import {
  CAP_ERROR_CODES,
  CapPluginError,
  SingleFlightGate,
  canTaskPublishState,
  clearSensitiveState,
  createSensitiveState,
  createTaskSignal,
  normalizeTimeoutMs,
  raceTask,
  runMiniVerification,
  solveWeixinChallenges,
  suppressTaskState
} from "../js_sdk/index.js";

function challenge() {
  return {
    clientSessionId: "client-session",
    protocol: "cap-pow-v1",
    challenges: [["salt", "0"]],
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };
}

test("小程序验证按凭证、挑战、求解、兑换顺序执行", async () => {
  const calls = [];
  const stages = [];
  const sensitive = [];
  const { signal } = createTaskSignal();
  const result = await runMiniVerification({
    platform: "wechat",
    purpose: "submit_form",
    binding: { resourceId: "1" },
    requestId: "request-1",
    signal,
    getLoginCode: async () => {
      calls.push("login");
      return "one-time-code";
    },
    createMiniChallenge: async (request) => {
      calls.push("challenge");
      assert.equal(request.loginCode, "one-time-code");
      return challenge();
    },
    solveChallenges: async () => {
      calls.push("solve");
      return [7];
    },
    redeemMiniChallenge: async (request) => {
      calls.push("redeem");
      assert.deepEqual({ clientSessionId: request.clientSessionId, solutions: request.solutions }, {
        clientSessionId: "client-session",
        solutions: [7]
      });
      return {
        captchaVerification: "mpcap1_ticket",
        expiresAt: new Date(Date.now() + 30000).toISOString()
      };
    },
    onStage: (state) => stages.push(state),
    onSensitive: (value) => sensitive.push({ ...value })
  });
  assert.deepEqual(calls, ["login", "challenge", "solve", "redeem"]);
  assert.deepEqual(stages, ["challenging", "solving", "redeeming"]);
  assert.deepEqual(sensitive.at(-1), { loginCode: "", clientSessionId: "" });
  assert.equal(result.platform, "wechat");
  assert.equal(result.captchaVerification, "mpcap1_ticket");
});

test("求解阶段取消后不调用 redeem", async () => {
  const controller = createTaskSignal();
  let redeemCount = 0;
  const startedAt = Date.now();
  await assert.rejects(
    runMiniVerification({
      platform: "wechat",
      purpose: "sms_send",
      binding: {},
      requestId: "request-cancel",
      signal: controller.signal,
      getLoginCode: async () => "code",
      createMiniChallenge: async () => challenge(),
      solveChallenges: async () => {
        controller.cancel(new CapPluginError(CAP_ERROR_CODES.CANCELLED, "已取消安全验证"));
        return [1];
      },
      redeemMiniChallenge: async () => {
        redeemCount += 1;
        return {};
      }
    }),
    (error) => error.code === CAP_ERROR_CODES.CANCELLED
  );
  assert.equal(redeemCount, 0);
  assert.ok(Date.now() - startedAt < 300, "取消应在 300ms 内反馈");
});

test("单任务门闩拒绝并发并能清理", () => {
  const gate = new SingleFlightGate();
  const task = gate.begin({ requestId: "one" });
  assert.throws(() => gate.begin({ requestId: "two" }), (error) => error.code === CAP_ERROR_CODES.BUSY);
  assert.equal(gate.cancel(), true);
  assert.equal(task.controller.signal.cancelled, true);
  gate.finish(task);
  assert.equal(gate.current, null);
});

test("默认 30 秒定时器在快速成功后清理，短超时会拒绝", async () => {
  assert.equal(normalizeTimeoutMs(undefined), 30000);
  const startedAt = Date.now();
  assert.equal(await raceTask(Promise.resolve("ok"), { timeoutMs: 30000 }), "ok");
  assert.ok(Date.now() - startedAt < 100);

  const timeoutStartedAt = Date.now();
  await assert.rejects(
    raceTask(new Promise(() => {}), { timeoutMs: 1 }),
    (error) => error.code === CAP_ERROR_CODES.TIMEOUT
  );
  assert.ok(Date.now() - timeoutStartedAt >= 900);
});

test("微信 Worker 取消会 terminate，且流程不会 redeem", async () => {
  let terminateCount = 0;
  let redeemCount = 0;
  let workerMessageHandler = null;
  const mockWorker = {
    onMessage(handler) { workerMessageHandler = handler; },
    onError() {},
    postMessage() {},
    terminate() { terminateCount += 1; }
  };
  const wxApi = { createWorker: () => mockWorker };
  const controller = createTaskSignal();
  const flow = runMiniVerification({
    platform: "wechat",
    purpose: "sms_login",
    binding: {},
    requestId: "worker-cancel",
    signal: controller.signal,
    getLoginCode: async () => "code",
    createMiniChallenge: async () => challenge(),
    solveChallenges: (challenges, signal) => solveWeixinChallenges(challenges, { signal, wxApi }),
    redeemMiniChallenge: async () => {
      redeemCount += 1;
      return {};
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(typeof workerMessageHandler, "function");
  controller.cancel(new CapPluginError(CAP_ERROR_CODES.CANCELLED, "cancel"));
  await assert.rejects(flow, (error) => error.code === CAP_ERROR_CODES.CANCELLED);
  assert.equal(terminateCount, 1);
  assert.equal(redeemCount, 0);
});

test("challenge 等待期间超时会 abort 并立即清理平台 code", async () => {
  const controller = createTaskSignal();
  const sensitive = [];
  let abortCount = 0;
  let challengeSignal = null;
  let notifyChallengeStarted;
  const challengeStarted = new Promise((resolve) => { notifyChallengeStarted = resolve; });
  const flow = runMiniVerification({
    platform: "wechat",
    purpose: "sms_login",
    binding: {},
    requestId: "challenge-cancel",
    signal: controller.signal,
    getLoginCode: async () => "one-time-code",
    createMiniChallenge: (request) => {
      challengeSignal = request.signal;
      notifyChallengeStarted();
      return {
        promise: new Promise(() => {}),
        abort() { abortCount += 1; }
      };
    },
    solveChallenges: async () => [],
    redeemMiniChallenge: async () => ({}),
    onSensitive: (value) => sensitive.push({ ...value })
  });

  await challengeStarted;
  controller.cancel(new CapPluginError(CAP_ERROR_CODES.TIMEOUT, "timeout"));
  await assert.rejects(flow, (error) => error.code === CAP_ERROR_CODES.TIMEOUT);
  assert.equal(challengeSignal, controller.signal);
  assert.equal(abortCount, 1);
  assert.deepEqual(sensitive.at(-1), { loginCode: "", clientSessionId: "" });
});

test("redeem 等待期间取消会 abort、清理会话且不返回票据", async () => {
  const controller = createTaskSignal();
  const sensitive = [];
  let abortCount = 0;
  let redeemSignal = null;
  let notifyRedeemStarted;
  const redeemStarted = new Promise((resolve) => { notifyRedeemStarted = resolve; });
  const flow = runMiniVerification({
    platform: "baidu",
    purpose: "submit_form",
    binding: {},
    requestId: "redeem-cancel",
    signal: controller.signal,
    getLoginCode: async () => "one-time-code",
    createMiniChallenge: async () => challenge(),
    solveChallenges: async () => [7],
    redeemMiniChallenge: (request) => {
      redeemSignal = request.signal;
      notifyRedeemStarted();
      return {
        promise: new Promise(() => {}),
        abort() { abortCount += 1; }
      };
    },
    onSensitive: (value) => sensitive.push({ ...value })
  });

  await redeemStarted;
  controller.cancel(new CapPluginError(CAP_ERROR_CODES.CANCELLED, "cancel"));
  await assert.rejects(flow, (error) => error.code === CAP_ERROR_CODES.CANCELLED);
  assert.equal(redeemSignal, controller.signal);
  assert.equal(abortCount, 1);
  assert.deepEqual(sensitive.at(-1), { loginCode: "", clientSessionId: "" });
});

test("微信求解收到已取消信号时仍返回取消错误并回收 Worker", async () => {
  const controller = createTaskSignal();
  controller.cancel(new CapPluginError(CAP_ERROR_CODES.CANCELLED, "cancel"));
  let terminateCount = 0;
  let postMessageCount = 0;
  const worker = {
    onMessage() {},
    onError() {},
    postMessage() { postMessageCount += 1; },
    terminate() { terminateCount += 1; }
  };

  await assert.rejects(
    solveWeixinChallenges([["salt", "0"]], {
      signal: controller.signal,
      wxApi: { createWorker: () => worker }
    }),
    (error) => error.code === CAP_ERROR_CODES.CANCELLED
  );
  assert.equal(terminateCount, 1);
  assert.equal(postMessageCount, 0);
});

test("reset 淘汰旧任务后，旧 finally 不会覆盖或清理新任务", () => {
  const gate = new SingleFlightGate();
  const oldTask = gate.begin({ requestId: "old" });
  oldTask.sensitive = createSensitiveState();
  oldTask.sensitive.loginCode = "old-code";
  suppressTaskState(oldTask);
  gate.reset();

  const newTask = gate.begin({ requestId: "new" });
  newTask.sensitive = createSensitiveState();
  newTask.sensitive.loginCode = "new-code";
  clearSensitiveState(oldTask.sensitive);
  gate.finish(oldTask);

  assert.equal(canTaskPublishState(oldTask), false);
  assert.equal(canTaskPublishState(newTask), true);
  assert.equal(newTask.sensitive.loginCode, "new-code");
  assert.equal(gate.current, newTask);
});
