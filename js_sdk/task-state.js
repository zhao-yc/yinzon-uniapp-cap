/** 标记旧任务不再有权覆盖组件状态，供 reset 后立即重试使用。 */
export function suppressTaskState(task) {
  if (!task) return false;
  task.suppressState = true;
  return true;
}

/** 只有未被 reset 淘汰的任务可以发布终态。 */
export function canTaskPublishState(task) {
  return Boolean(task && task.suppressState !== true);
}

/** 为每个任务分配独立敏感区，禁止旧任务 finally 清理新任务数据。 */
export function createSensitiveState() {
  return { loginCode: "", clientSessionId: "", captchaVerification: "" };
}

/** 就地清空任务敏感区，便于 finally 后验证无残留。 */
export function clearSensitiveState(state) {
  if (!state) return;
  state.loginCode = "";
  state.clientSessionId = "";
  state.captchaVerification = "";
}
