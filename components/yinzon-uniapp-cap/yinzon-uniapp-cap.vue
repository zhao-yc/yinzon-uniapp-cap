<template>
  <view class="yinzon-uniapp-cap" :class="`yinzon-uniapp-cap--${state}`">
    <!-- #ifdef APP-PLUS -->
    <view
      :id="renderHostId"
      class="yinzon-uniapp-cap__render-host"
      :cap-command="renderCommand"
      :change:cap-command="capRenderer.onCommand"
    ></view>
    <!-- #endif -->

    <view v-if="showStatus && state !== 'idle'" class="yinzon-uniapp-cap__status" role="status" aria-live="polite">
      <view v-if="isRunning" class="yinzon-uniapp-cap__spinner" aria-hidden="true"></view>
      <view class="yinzon-uniapp-cap__message">{{ message }}</view>
      <view v-if="state === 'solving'" class="yinzon-uniapp-cap__progress">{{ progress }}%</view>
    </view>

    <!-- #ifdef MP-BAIDU -->
    <button
      v-if="baiduLoginRequired"
      class="yinzon-uniapp-cap__baidu-login"
      type="default"
      open-type="login"
      @login="handleBaiduLogin"
    >登录百度并继续验证</button>
    <!-- #endif -->
  </view>
</template>

<script>
import {
  CAP_ERROR_CODES,
  CAP_STATES,
  CapPluginError,
  SingleFlightGate,
  canTaskPublishState,
  clearSensitiveState,
  createSensitiveState,
  isCancelledError,
  normalizeCapError,
  normalizeTimeoutMs,
  normalizeVerificationResult,
  raceTask,
  runMiniVerification,
  solveBaiduChallenges,
  solveWeixinChallenges,
  suppressTaskState,
  DEFAULT_WEIXIN_WORKER_PATH,
  DEFAULT_WEIXIN_WASM_PATH
} from "../../js_sdk/index.js";

const RUNNING_STATES = new Set([
  CAP_STATES.ATTESTING,
  CAP_STATES.CHALLENGING,
  CAP_STATES.SOLVING,
  CAP_STATES.REDEEMING
]);

function createRequestId(sequence) {
  return `cap_${Date.now().toString(36)}_${sequence.toString(36)}`;
}

function detectPlatform() {
  let platform = "unsupported";
  // #ifdef APP-PLUS
  platform = "app";
  // #endif
  // #ifdef MP-WEIXIN
  platform = "wechat";
  // #endif
  // #ifdef MP-BAIDU
  platform = "baidu";
  // #endif
  return platform;
}

function assertSerializableBinding(binding) {
  if (binding === undefined || binding === null) return {};
  if (typeof binding !== "object" || Array.isArray(binding)) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_REQUEST, "安全验证绑定信息格式无效");
  }
  try {
    return JSON.parse(JSON.stringify(binding));
  } catch (error) {
    throw new CapPluginError(CAP_ERROR_CODES.INVALID_REQUEST, "安全验证绑定信息不可序列化", error);
  }
}

export default {
  name: "YinzonUniappCap",
  emits: ["statechange"],
  props: {
    adapter: {
      type: Object,
      required: true
    },
    showStatus: {
      type: Boolean,
      default: true
    },
    timeoutMs: {
      type: Number,
      default: 30000
    },
    weixinWorkerPath: {
      type: String,
      default: DEFAULT_WEIXIN_WORKER_PATH
    },
    weixinWasmPath: {
      type: String,
      default: DEFAULT_WEIXIN_WASM_PATH
    }
  },
  data() {
    return {
      state: CAP_STATES.IDLE,
      platform: detectPlatform(),
      progress: 0,
      message: "",
      baiduLoginRequired: false,
      renderHostId: `yinzon-uniapp-cap-render-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      renderCommand: {
        revision: 0,
        type: "idle",
        requestId: ""
      }
    };
  },
  computed: {
    isRunning() {
      return RUNNING_STATES.has(this.state);
    }
  },
  created() {
    this._gate = new SingleFlightGate();
    this._requestSequence = 0;
    this._appDeferred = null;
    this._baiduLoginDeferred = null;
    this._baiduLoginAttemptSequence = 0;
  },
  beforeUnmount() {
    this._teardownCap();
  },
  beforeDestroy() {
    this._teardownCap();
  },
  methods: {
    /**
     * 执行一次安全验证。相同组件禁止并发；任何失败均不会返回半成品票据。
     */
    async verify(options = {}) {
      const purpose = String(options.purpose || "").trim();
      if (!purpose || purpose.length > 64) {
        throw new CapPluginError(CAP_ERROR_CODES.INVALID_REQUEST, "安全验证用途无效");
      }
      const binding = assertSerializableBinding(options.binding);
      const requestId = createRequestId(++this._requestSequence);
      const task = this._gate.begin({ requestId, purpose });
      task.sensitive = createSensitiveState();
      const timeoutMs = normalizeTimeoutMs(options.timeoutMs, normalizeTimeoutMs(this.timeoutMs));
      this.baiduLoginRequired = false;

      try {
        this._emitState(CAP_STATES.ATTESTING, 0, "正在获取平台凭证…", requestId);
        const execution = this._runPlatformVerification({
          requestId,
          purpose,
          binding,
          task,
          signal: task.controller.signal
        });
        const result = await raceTask(execution, { signal: task.controller.signal, timeoutMs });
        task.controller.signal.throwIfCancelled();
        task.sensitive.captchaVerification = result.captchaVerification;
        this._emitState(CAP_STATES.SUCCESS, 100, "安全验证已完成", requestId);
        return result;
      } catch (error) {
        const normalized = normalizeCapError(error, CAP_ERROR_CODES.SOLVE_FAILED, "安全验证失败，请稍后重试");
        if (normalized.code === CAP_ERROR_CODES.TIMEOUT) {
          task.controller.cancel(normalized);
          this._cancelPlatformResources(requestId);
        }
        if (canTaskPublishState(task)) {
          if (isCancelledError(normalized)) {
            if (this.state !== CAP_STATES.CANCELLED) {
              this._emitState(CAP_STATES.CANCELLED, 0, "已取消安全验证", requestId, normalized.code);
            }
          } else {
            this._emitState(CAP_STATES.ERROR, 0, normalized.message, requestId, normalized.code);
          }
        }
        throw normalized;
      } finally {
        this._rejectBaiduLogin(new CapPluginError(CAP_ERROR_CODES.CANCELLED, "已取消安全验证"), task);
        this._clearSensitive(task);
        if (!this._baiduLoginDeferred || this._baiduLoginDeferred.task === task) {
          this.baiduLoginRequired = false;
        }
        this._gate.finish(task);
      }
    },

    /** 立即取消并释放 Worker、iframe 和临时凭证。 */
    cancel() {
      const task = this._gate.current;
      if (!task) return false;
      const error = new CapPluginError(CAP_ERROR_CODES.CANCELLED, "已取消安全验证");
      this._gate.cancel(error);
      this._cancelPlatformResources(task.requestId);
      this._rejectBaiduLogin(error, task);
      this._clearSensitive(task);
      if (!this._baiduLoginDeferred || this._baiduLoginDeferred.task === task) {
        this.baiduLoginRequired = false;
      }
      if (canTaskPublishState(task)) {
        this._emitState(CAP_STATES.CANCELLED, 0, error.message, task.requestId, error.code);
      }
      return true;
    },

    /** 清理上一次结果并恢复初始展示状态。 */
    reset() {
      const currentTask = this._gate.current;
      const requestId = currentTask?.requestId || "";
      suppressTaskState(currentTask);
      this.cancel();
      this._gate.reset();
      this._dispatchRenderCommand("reset", requestId);
      this._clearSensitive(currentTask);
      this.baiduLoginRequired = false;
      this._emitState(CAP_STATES.IDLE, 0, "", "");
    },

    async _runPlatformVerification(context) {
      if (this.platform === "app") return this._verifyApp(context);
      if (this.platform === "wechat") return this._verifyMiniProgram(context, "wechat");
      if (this.platform === "baidu") return this._verifyMiniProgram(context, "baidu");
      throw new CapPluginError(CAP_ERROR_CODES.UNSUPPORTED_PLATFORM, "当前平台暂不支持安全验证");
    },

    async _verifyApp(context) {
      this._assertAdapterMethod("loadWebConfig");
      this._emitState(CAP_STATES.CHALLENGING, 0, "正在获取安全验证挑战…", context.requestId);
      const config = await this.adapter.loadWebConfig({
        platform: "app",
        purpose: context.purpose,
        binding: context.binding,
        requestId: context.requestId
      });
      context.signal.throwIfCancelled();
      if (!config || typeof config.apiEndpoint !== "string" || !config.apiEndpoint.trim()) {
        throw new CapPluginError(CAP_ERROR_CODES.CHALLENGE_FAILED, "安全验证服务配置无效");
      }

      this._emitState(CAP_STATES.SOLVING, 0, "正在进行安全验证…", context.requestId);
      const result = await this._requestAppSolve(context, {
        apiEndpoint: config.apiEndpoint.trim(),
        headers: config.headers && typeof config.headers === "object" ? config.headers : {},
        // 明文 HTTP 仅允许适配器在本地开发时显式开启，生产默认只接受 HTTPS。
        allowInsecureHttpForDevelopment: config.allowInsecureHttpForDevelopment === true
      });
      return normalizeVerificationResult(result, "app");
    },

    async _verifyMiniProgram(context, platform) {
      this._assertAdapterMethod("createMiniChallenge");
      this._assertAdapterMethod("redeemMiniChallenge");
      const onProgress = (progress) => {
        if (!context.signal.cancelled) {
          this._emitState(CAP_STATES.SOLVING, progress, "正在计算安全验证…", context.requestId);
        }
      };
      return runMiniVerification({
        platform,
        purpose: context.purpose,
        binding: context.binding,
        requestId: context.requestId,
        signal: context.signal,
        getLoginCode: async (signal) => {
          const code = platform === "wechat"
            ? await this._getWeixinLoginCode(signal)
            : await this._getBaiduLoginCode(signal, context.task);
          context.task.sensitive.loginCode = code;
          return code;
        },
        createMiniChallenge: (request) => this.adapter.createMiniChallenge(request),
        solveChallenges: (challenges, signal) => platform === "wechat"
          ? solveWeixinChallenges(challenges, {
            signal,
            onProgress,
            workerPath: this.weixinWorkerPath,
            wasmPath: this.weixinWasmPath
          })
          : solveBaiduChallenges(challenges, { signal, onProgress, sliceMs: 16 }),
        redeemMiniChallenge: (request) => this.adapter.redeemMiniChallenge(request),
        onSession: (clientSessionId) => {
          context.task.sensitive.clientSessionId = clientSessionId;
        },
        onSensitive: ({ loginCode, clientSessionId }) => {
          context.task.sensitive.loginCode = loginCode;
          context.task.sensitive.clientSessionId = clientSessionId;
        },
        onStage: (state, progress, message) => {
          this._emitState(state, progress, message, context.requestId);
        }
      });
    },

    _assertAdapterMethod(name) {
      if (!this.adapter || typeof this.adapter[name] !== "function") {
        throw new CapPluginError(CAP_ERROR_CODES.INVALID_ADAPTER, `缺少安全验证适配器方法：${name}`);
      }
    },

    _getWeixinLoginCode(signal) {
      return new Promise((resolve, reject) => {
        // #ifdef MP-WEIXIN
        const api = typeof wx !== "undefined" ? wx : null;
        if (!api || typeof api.login !== "function") {
          reject(new CapPluginError(CAP_ERROR_CODES.PLATFORM_ATTESTATION_FAILED, "微信平台凭证不可用"));
          return;
        }
        const removeCancel = signal.onCancel((reason) => reject(reason));
        api.login({
          timeout: 10000,
          success: (result) => {
            removeCancel();
            const code = String(result && result.code || "");
            if (code) resolve(code);
            else reject(new CapPluginError(CAP_ERROR_CODES.PLATFORM_ATTESTATION_FAILED, "获取微信平台凭证失败"));
          },
          fail: (error) => {
            removeCancel();
            reject(new CapPluginError(CAP_ERROR_CODES.PLATFORM_ATTESTATION_FAILED, "获取微信平台凭证失败", error));
          }
        });
        // #endif
        // #ifndef MP-WEIXIN
        reject(new CapPluginError(CAP_ERROR_CODES.UNSUPPORTED_PLATFORM, "当前不是微信小程序环境"));
        // #endif
      });
    },

    _getBaiduLoginCode(signal, task) {
      return new Promise((resolve, reject) => {
        // #ifdef MP-BAIDU
        const api = typeof swan !== "undefined" ? swan : null;
        if (!api || typeof api.getLoginCode !== "function") {
          reject(new CapPluginError(CAP_ERROR_CODES.PLATFORM_ATTESTATION_FAILED, "百度平台凭证不可用"));
          return;
        }
        const removeCancel = signal.onCancel((reason) => reject(reason));
        api.getLoginCode({
          success: (result) => {
            if (signal.cancelled) return;
            const code = String(result && (result.code || result.authorizationCode) || "");
            if (code) {
              removeCancel();
              resolve(code);
              return;
            }
            this._awaitBaiduUserLogin(resolve, reject, removeCancel, signal, task);
          },
          fail: () => this._awaitBaiduUserLogin(resolve, reject, removeCancel, signal, task)
        });
        // #endif
        // #ifndef MP-BAIDU
        reject(new CapPluginError(CAP_ERROR_CODES.UNSUPPORTED_PLATFORM, "当前不是百度小程序环境"));
        // #endif
      });
    },

    _awaitBaiduUserLogin(resolve, reject, removeCancel, signal, task) {
      if (signal.cancelled) {
        removeCancel?.();
        reject(signal.reason || new CapPluginError(CAP_ERROR_CODES.CANCELLED, "已取消安全验证"));
        return;
      }
      this.baiduLoginRequired = true;
      this.message = "请登录百度后继续安全验证";
      this._baiduLoginDeferred = {
        id: ++this._baiduLoginAttemptSequence,
        resolve,
        reject,
        removeCancel,
        signal,
        task
      };
    },

    /** 百度 open-type=login 只能由用户点击触发，成功后继续原 Promise。 */
    handleBaiduLogin(event) {
      const deferred = this._baiduLoginDeferred;
      if (!deferred) return;
      if (deferred.signal.cancelled) {
        this._rejectBaiduLogin(deferred.signal.reason || new CapPluginError(CAP_ERROR_CODES.CANCELLED, "已取消安全验证"));
        return;
      }
      const directCode = String(event && event.detail && (event.detail.code || event.detail.authorizationCode) || "");
      if (directCode) {
        this.baiduLoginRequired = false;
        this._baiduLoginDeferred = null;
        deferred.removeCancel?.();
        deferred.resolve(directCode);
        return;
      }
      // #ifdef MP-BAIDU
      const api = typeof swan !== "undefined" ? swan : null;
      api?.getLoginCode?.({
        success: (result) => {
          if (this._baiduLoginDeferred !== deferred || deferred.signal.cancelled) return;
          const code = String(result && (result.code || result.authorizationCode) || "");
          if (!code) {
            this.baiduLoginRequired = false;
            this._baiduLoginDeferred = null;
            deferred.removeCancel?.();
            deferred.reject(new CapPluginError(CAP_ERROR_CODES.PLATFORM_ATTESTATION_FAILED, "未完成百度平台登录"));
            return;
          }
          this.baiduLoginRequired = false;
          this._baiduLoginDeferred = null;
          deferred.removeCancel?.();
          deferred.resolve(code);
        },
        fail: (error) => {
          if (this._baiduLoginDeferred !== deferred || deferred.signal.cancelled) return;
          this.baiduLoginRequired = false;
          this._baiduLoginDeferred = null;
          deferred.removeCancel?.();
          deferred.reject(new CapPluginError(CAP_ERROR_CODES.PLATFORM_ATTESTATION_FAILED, "未完成百度平台登录", error));
        }
      });
      // #endif
    },

    _rejectBaiduLogin(error, task = null) {
      const deferred = this._baiduLoginDeferred;
      if (!deferred) return;
      if (task && deferred.task !== task) return;
      this._baiduLoginDeferred = null;
      deferred.removeCancel?.();
      deferred.reject(error);
    },

    _requestAppSolve(context, config) {
      return new Promise((resolve, reject) => {
        const deferred = { requestId: context.requestId, resolve, reject, removeCancel: () => {} };
        this._appDeferred = deferred;
        const removeCancel = context.signal.onCancel((reason) => {
          if (this._appDeferred?.requestId === context.requestId) this._appDeferred = null;
          this._dispatchRenderCommand("cancel", context.requestId);
          reject(reason);
        });
        deferred.removeCancel = removeCancel;
        if (context.signal.cancelled) return;
        this._dispatchRenderCommand("solve", context.requestId, config);
      });
    },

    /** renderjs 只把无敏感上下文的状态和最终票据交还逻辑层。 */
    handleRenderEvent(payload) {
      const deferred = this._appDeferred;
      if (!deferred || !payload || payload.requestId !== deferred.requestId) return;
      if (payload.type === "progress") {
        this._emitState(CAP_STATES.SOLVING, payload.progress, "正在进行安全验证…", payload.requestId);
        return;
      }
      this._appDeferred = null;
      deferred.removeCancel?.();
      if (payload.type === "success") {
        deferred.resolve({ captchaVerification: payload.token, expiresAt: payload.expiresAt || null });
      } else {
        deferred.reject(new CapPluginError(CAP_ERROR_CODES.APP_BRIDGE_FAILED, payload.message || "App 安全验证失败"));
      }
    },

    _dispatchRenderCommand(type, requestId, config = null) {
      this.renderCommand = {
        revision: Number(this.renderCommand.revision || 0) + 1,
        type,
        requestId: requestId || "",
        hostId: this.renderHostId,
        config
      };
    },

    _cancelPlatformResources(requestId) {
      if (this.platform === "app") this._dispatchRenderCommand("cancel", requestId);
      const deferred = this._appDeferred;
      if (deferred && deferred.requestId === requestId) {
        this._appDeferred = null;
        deferred.removeCancel?.();
      }
    },

    _clearSensitive(task) {
      if (task?.sensitive) {
        clearSensitiveState(task.sensitive);
      }
    },

    /** Vue 2/3 生命周期均调用同一个幂等清理入口。 */
    _teardownCap() {
      const requestId = this._gate?.current?.requestId || "";
      this.cancel();
      this._dispatchRenderCommand("destroy", requestId);
    },

    _emitState(state, progress, message, requestId, errorCode) {
      this.state = state;
      this.progress = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
      this.message = message || "";
      const detail = {
        state,
        platform: this.platform,
        progress: this.progress,
        message: this.message,
        requestId: requestId || ""
      };
      if (errorCode) detail.errorCode = errorCode;
      this.$emit("statechange", detail);
    }
  }
};
</script>

<!-- #ifdef APP-PLUS -->
<script module="capRenderer" lang="renderjs">
const CAP_WIDGET_VERSION = "0.1.50";
const CAP_WASM_VERSION = "0.0.7";
const PAKO_VERSION = "2.1.0";
const CAP_WIDGET_URL = "./uni_modules/yinzon-uniapp-cap/hybrid/html/yinzon-uniapp-cap/cap.min.js";
const CAP_WASM_FILE = "_www/uni_modules/yinzon-uniapp-cap/hybrid/html/yinzon-uniapp-cap/cap_wasm_bg.wasm";
const PAKO_URL = "./uni_modules/yinzon-uniapp-cap/hybrid/html/yinzon-uniapp-cap/pako_inflate.min.js";
const RESOURCE_TIMEOUT_MS = 10000;
const NETWORK_TIMEOUT_MS = 20000;

let activeFrame = null;
let activeHostObserver = null;
let activeRequestId = "";
let lastRevision = -1;
let activeWasmUrl = "";
let activeWasmReader = null;
let activeResourceGeneration = 0;
const activeXhrs = new Set();

function safeHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^[A-Za-z0-9-]+$/.test(key) && typeof item === "string") output[key] = item;
  }
  return output;
}

function loadScript(frameWindow, url, expected) {
  return new Promise((resolve, reject) => {
    const script = frameWindow.document.createElement("script");
    const timer = setTimeout(() => finish(new Error(`本地资源加载超时：${expected}`)), RESOURCE_TIMEOUT_MS);
    const finish = (error) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    script.src = url;
    script.dataset.yinzonUniappCapResource = expected;
    script.onload = () => finish();
    script.onerror = () => finish(new Error(`本地资源加载失败：${expected}`));
    frameWindow.document.head.appendChild(script);
  });
}

function parseResponseHeaders(rawHeaders) {
  const entries = {};
  String(rawHeaders || "").split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) return;
    entries[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  });
  return entries;
}

/** 创建 Cap Widget 所需的最小 Response，支持 json、text 和 clone。 */
function createCapResponse(status, statusText, responseText, rawHeaders) {
  const normalizedStatus = Number(status) || 0;
  const body = String(responseText || "");
  const headers = parseResponseHeaders(rawHeaders);
  return {
    ok: normalizedStatus >= 200 && normalizedStatus < 300,
    status: normalizedStatus,
    statusText: String(statusText || ""),
    headers: {
      get(name) {
        return headers[String(name || "").toLowerCase()] || null;
      }
    },
    async json() {
      return JSON.parse(body);
    },
    async text() {
      return body;
    },
    clone() {
      return createCapResponse(normalizedStatus, statusText, body, rawHeaders);
    }
  };
}

function normalizeCapEndpoint(value, allowInsecureHttpForDevelopment = false) {
  const endpoint = new URL(String(value || ""));
  const allowsHttp = endpoint.protocol === "http:" && allowInsecureHttpForDevelopment === true;
  if (endpoint.protocol !== "https:" && !allowsHttp) {
    throw new Error("Cap API 地址协议无效");
  }
  endpoint.username = "";
  endpoint.password = "";
  endpoint.hash = "";
  endpoint.search = "";
  if (!endpoint.pathname.endsWith("/")) endpoint.pathname += "/";
  return endpoint;
}

/** 只允许访问 adapter 固定 endpoint 下的 challenge/redeem。 */
function resolveAllowedCapUrl(value, apiEndpoint, allowInsecureHttpForDevelopment = false) {
  const endpoint = normalizeCapEndpoint(apiEndpoint, allowInsecureHttpForDevelopment);
  const target = new URL(String(value || ""), endpoint.href);
  const allowedPaths = new Set([`${endpoint.pathname}challenge`, `${endpoint.pathname}redeem`]);
  if (
    target.origin !== endpoint.origin
    || !allowedPaths.has(target.pathname)
    || target.username
    || target.password
    || target.search
    || target.hash
  ) {
    throw new Error("Cap 请求地址越界");
  }
  return target.href;
}

/** plus.net 原生跨域请求不依赖 WebView 的 Origin/CORS。 */
function plusCapFetch(url, options, apiEndpoint, sharedHeaders, allowInsecureHttpForDevelopment = false) {
  return new Promise((resolve, reject) => {
    if (typeof plus === "undefined" || !plus.net || typeof plus.net.XMLHttpRequest !== "function") {
      reject(new Error("App 原生网络能力不可用"));
      return;
    }
    let requestUrl;
    try {
      requestUrl = resolveAllowedCapUrl(url, apiEndpoint, allowInsecureHttpForDevelopment);
    } catch (error) {
      reject(error);
      return;
    }
    const method = String(options && options.method || "POST").toUpperCase();
    if (method !== "POST") {
      reject(new Error("Cap 请求方法不受支持"));
      return;
    }

    const xhr = new plus.net.XMLHttpRequest();
    activeXhrs.add(xhr);
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      activeXhrs.delete(xhr);
      xhr.onreadystatechange = null;
      xhr.onerror = null;
      xhr.ontimeout = null;
      xhr.onabort = null;
      callback(value);
    };
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      finish(resolve, createCapResponse(
        xhr.status,
        xhr.statusText,
        xhr.responseText,
        typeof xhr.getAllResponseHeaders === "function" ? xhr.getAllResponseHeaders() : ""
      ));
    };
    xhr.onerror = () => finish(reject, new Error("Cap 网络请求失败"));
    xhr.ontimeout = () => finish(reject, new Error("Cap 网络请求超时"));
    xhr.onabort = () => finish(reject, new Error("Cap 网络请求已取消"));
    xhr.open(method, requestUrl);
    xhr.timeout = NETWORK_TIMEOUT_MS;
    const headers = {
      ...safeHeaders(sharedHeaders),
      ...safeHeaders(options && options.headers)
    };
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.send(options && options.body != null ? String(options.body) : null);
  });
}

/** 通过 plus.io 读取固定 WASM，再生成 Blob URL，规避 file:// fetch 限制。 */
function loadLocalWasmBlobUrl(resourceGeneration) {
  return new Promise((resolve, reject) => {
    const ensureCurrentGeneration = () => {
      if (resourceGeneration !== activeResourceGeneration) {
        throw new Error("Cap WASM 本地资源读取已取消");
      }
    };
    if (typeof plus === "undefined" || !plus.io || typeof plus.io.resolveLocalFileSystemURL !== "function") {
      reject(new Error("App 本地资源能力不可用"));
      return;
    }
    plus.io.resolveLocalFileSystemURL(CAP_WASM_FILE, (entry) => {
      try {
        ensureCurrentGeneration();
      } catch (error) {
        reject(error);
        return;
      }
      entry.file((file) => {
        try {
          ensureCurrentGeneration();
        } catch (error) {
          reject(error);
          return;
        }
        const reader = new plus.io.FileReader();
        activeWasmReader = reader;
        reader.onloadend = (event) => {
          // abort 后 onloadend 仍可能到达；非当前任务禁止再创建 Blob URL。
          if (resourceGeneration !== activeResourceGeneration || activeWasmReader !== reader) {
            reject(new Error("Cap WASM 本地资源读取已取消"));
            return;
          }
          activeWasmReader = null;
          if (reader.error) {
            reject(new Error("Cap WASM 本地资源读取失败"));
            return;
          }
          try {
            const dataUrl = String(event && event.target && event.target.result || "");
            const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
            if (!base64) throw new Error("empty wasm");
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            const wasmUrl = URL.createObjectURL(new Blob([bytes], { type: "application/wasm" }));
            if (resourceGeneration !== activeResourceGeneration) {
              URL.revokeObjectURL(wasmUrl);
              reject(new Error("Cap WASM 本地资源读取已取消"));
              return;
            }
            activeWasmUrl = wasmUrl;
            resolve(wasmUrl);
          } catch (error) {
            reject(new Error("Cap WASM 本地资源解析失败"));
          }
        };
        try {
          reader.readAsDataURL(file);
        } catch (error) {
          if (activeWasmReader === reader) activeWasmReader = null;
          reject(new Error("Cap WASM 本地资源读取失败"));
        }
      }, () => reject(new Error("Cap WASM 本地文件不可用")));
    }, () => reject(new Error("Cap WASM 本地路径不可用")));
  });
}

/** 销毁独立 browsing context，可同步终止 Cap 0.1.50 内部局部 WorkerPool。 */
function destroyFrame() {
  // 每次清理都会淘汰尚未进入 FileReader 阶段的旧 plus.io 回调。
  activeResourceGeneration += 1;
  const frame = activeFrame;
  activeFrame = null;
  activeRequestId = "";
  if (activeHostObserver) {
    activeHostObserver.disconnect();
    activeHostObserver = null;
  }
  for (const xhr of [...activeXhrs]) {
    try { xhr.abort(); } catch (error) {}
  }
  activeXhrs.clear();
  if (activeWasmReader) {
    try { activeWasmReader.abort(); } catch (error) {}
    activeWasmReader = null;
  }
  if (activeWasmUrl) {
    try { URL.revokeObjectURL(activeWasmUrl); } catch (error) {}
    activeWasmUrl = "";
  }
  if (!frame) return;
  try {
    frame.src = "about:blank";
    frame.remove();
  } catch (error) {
    // 页面卸载阶段重复清理不影响业务。
  }
}

export default {
  onCommand(next, previous, ownerInstance) {
    const revision = Number(next && next.revision);
    if (!Number.isFinite(revision) || revision <= lastRevision) return;
    lastRevision = revision;
    const type = String(next.type || "");
    if (type === "cancel" || type === "reset" || type === "destroy") {
      destroyFrame();
      return;
    }
    if (type !== "solve") return;
    this.solve(next, ownerInstance);
  },

  async solve(command, ownerInstance) {
    destroyFrame();
    const resourceGeneration = activeResourceGeneration;
    const requestId = String(command.requestId || "");
    const config = command.config || {};
    activeRequestId = requestId;
    try {
      const host = document.getElementById(String(command.hostId || ""));
      if (!host) throw new Error("安全验证宿主节点不存在");
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;border:0;opacity:0;pointer-events:none";
      host.appendChild(frame);
      activeFrame = frame;
      if (typeof MutationObserver === "function") {
        activeHostObserver = new MutationObserver(() => {
          // 页面异常卸载且逻辑层钩子未送达时，也要中止原生请求并销毁验证环境。
          if (!host.isConnected) destroyFrame();
        });
        activeHostObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
      const frameWindow = frame.contentWindow;
      if (!frameWindow || !frameWindow.document) throw new Error("无法创建安全验证运行环境");

      const wasmBlobUrl = await loadLocalWasmBlobUrl(resourceGeneration);
      if (activeRequestId !== requestId || activeFrame !== frame) return;
      frameWindow.CAP_CUSTOM_WASM_URL = wasmBlobUrl;
      frameWindow.CAP_PAKO_URL = PAKO_URL;
      frameWindow.CAP_DONT_SKIP_REDEFINE = false;
      let tokenExpiresAt = null;
      const headers = safeHeaders(config.headers);
      frameWindow.CAP_CUSTOM_FETCH = async (url, options = {}) => {
        const response = await plusCapFetch(
          url,
          options,
          config.apiEndpoint,
          headers,
          config.allowInsecureHttpForDevelopment === true
        );
        if (String(url).includes("/redeem")) {
          const body = await response.clone().json();
          const expiresAt = body && body.expires;
          const timestamp = typeof expiresAt === "number" ? expiresAt : Date.parse(String(expiresAt || ""));
          if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
            throw new Error("Cap 票据有效期无效");
          }
          tokenExpiresAt = new Date(timestamp).toISOString();
        }
        return response;
      };

      await loadScript(frameWindow, CAP_WIDGET_URL, `cap-widget@${CAP_WIDGET_VERSION}`);
      if (activeRequestId !== requestId || activeFrame !== frame) return;
      if (typeof frameWindow.Cap !== "function") throw new Error("Cap Widget 本地版本不可用");
      const cap = new frameWindow.Cap({
        apiEndpoint: String(config.apiEndpoint || ""),
        "data-cap-worker-count": "1",
        "data-cap-disable-haptics": ""
      });
      cap.addEventListener("progress", (event) => {
        if (activeRequestId !== requestId) return;
        ownerInstance.callMethod("handleRenderEvent", {
          type: "progress",
          requestId,
          progress: Number(event && event.detail && event.detail.progress || 0)
        });
      });
      const result = await cap.solve();
      if (activeRequestId !== requestId || activeFrame !== frame) return;
      if (!result || !result.success || !result.token) throw new Error("Cap 验证未返回有效票据");
      ownerInstance.callMethod("handleRenderEvent", {
        type: "success",
        requestId,
        token: result.token,
        expiresAt: tokenExpiresAt
      });
      destroyFrame();
    } catch (error) {
      if (activeRequestId !== requestId) return;
      destroyFrame();
      ownerInstance.callMethod("handleRenderEvent", {
        type: "error",
        requestId,
        message: error && error.message || "App 安全验证失败"
      });
    }
  }
};
</script>
<!-- #endif -->

<style scoped>
.yinzon-uniapp-cap {
  width: 100%;
}

.yinzon-uniapp-cap__render-host {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.yinzon-uniapp-cap__status {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  min-height: 72rpx;
  padding: 16rpx 20rpx;
  border-radius: 16rpx;
  color: #315e5f;
  background: #eef8f7;
  font-size: 26rpx;
  line-height: 1.5;
}

.yinzon-uniapp-cap--error .yinzon-uniapp-cap__status {
  color: #9e3f3f;
  background: #fff2f2;
}

.yinzon-uniapp-cap__spinner {
  flex: 0 0 auto;
  width: 24rpx;
  height: 24rpx;
  margin-right: 14rpx;
  border: 4rpx solid rgba(20, 151, 154, 0.2);
  border-top-color: #14979a;
  border-radius: 50%;
  animation: yinzon-uniapp-cap-spin 0.8s linear infinite;
}

.yinzon-uniapp-cap__message {
  flex: 1;
  min-width: 0;
}

.yinzon-uniapp-cap__progress {
  flex: 0 0 auto;
  margin-left: 16rpx;
  font-variant-numeric: tabular-nums;
}

.yinzon-uniapp-cap__baidu-login {
  margin-top: 16rpx;
  color: #ffffff;
  background: #14979a;
  border: 0;
  border-radius: 16rpx;
  font-size: 28rpx;
}

.yinzon-uniapp-cap__baidu-login::after {
  border: 0;
}

@keyframes yinzon-uniapp-cap-spin {
  to { transform: rotate(360deg); }
}
</style>
