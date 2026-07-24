# yinzon-uniapp-cap

英纵提供的经典 uni-app Vue 3 Cap 安全验证组件。组件在当前表单内完成验证，不跳转
独立验证页，并以统一 API 适配 App、微信小程序和百度小程序。

本插件只实现客户端验证流程，**不是独立的验证码服务**。使用者必须提供自己的业务
后端、Cap 服务配置和适配器。插件不包含公共验证服务器、业务域名、平台 AppID、
site key、secret 或业务数据结构。

## 兼容性

| 运行平台 | 支持情况 | 验证方式 |
| --- | --- | --- |
| Android App（app-vue） | 支持 | 当前 WebView 内运行 Cap Widget、WASM 和 instrumentation |
| iOS App（app-vue） | 支持 | 当前 WebView 内运行 Cap Widget、WASM 和 instrumentation |
| 微信小程序 | 支持 | `wx.login` + Worker + `WXWebAssembly` |
| 百度小程序 | 支持 | `swan.getLoginCode` + 分片 JavaScript PoW |
| Vue 2、H5、nvue、HarmonyOS、uni-app x | 不支持 | 验证会失败关闭 |
| 其他小程序和快应用 | 不支持 | 验证会失败关闭 |

最低版本为 HBuilderX 4.0.0 和经典 uni-app 4.0.0，使用 Vue 3。

## 安装

从 DCloud 插件市场将 `yinzon-uniapp-cap` 导入项目。安装完成后目录应为：

```text
uni_modules/yinzon-uniapp-cap/
```

源码、版本标签和问题反馈位于
[`zhao-yc/yinzon-uniapp-cap`](https://github.com/zhao-yc/yinzon-uniapp-cap)。

组件遵循 easycom 目录约定，无需 import 或手工注册：

```vue
<yinzon-uniapp-cap
  ref="capVerifier"
  :adapter="capAdapter"
  :show-status="true"
  @statechange="handleCapState"
/>
```

```js
const result = await this.$refs.capVerifier.verify({
  purpose: "submit_form",
  binding: { resourceId: "example-resource-id" },
  timeoutMs: 30000
});

// {
//   captchaVerification: "...",
//   platform: "app" | "wechat" | "baidu",
//   expiresAt: "2026-07-24T12:00:00.000Z"
// }
```

业务接口只接收并在后端消费 `captchaVerification`。不要在客户端把“求解成功”直接
当作业务授权。

## 微信 Worker 配置

微信要求 Worker 文件位于 `manifest.json` 声明的唯一 Worker 根目录中。使用默认
路径时，在宿主的 `mp-weixin` 节点增加：

```json
{
  "mp-weixin": {
    "workers": "uni_modules/yinzon-uniapp-cap/static/yinzon-uniapp-cap"
  }
}
```

默认资源路径：

- Worker：`uni_modules/yinzon-uniapp-cap/static/yinzon-uniapp-cap/weixin-worker.js`
- WASM：`uni_modules/yinzon-uniapp-cap/static/yinzon-uniapp-cap/cap_wasm_bg.wasm`

若项目已经声明其他 Worker 根目录，请在构建阶段将这两个文件复制到现有根目录，
并通过 `weixin-worker-path`、`weixin-wasm-path` 传入编译产物中的实际路径。

编译后必须在微信开发者工具中确认 `app.json` 包含 `workers` 字段且两个资源实际
存在。微信端严格要求 Worker 和 `WXWebAssembly`；启动失败会关闭验证，不回退到
可能阻塞界面的主线程计算。

## 后端适配器

### 接口概览

宿主通过 `adapter` 注入三个异步方法：

```ts
type CapAdapter = {
  loadWebConfig?(request: AppConfigRequest): Promise<AppConfig>;
  createMiniChallenge?(request: MiniChallengeRequest): Promise<MiniChallenge>;
  redeemMiniChallenge?(request: MiniRedeemRequest): Promise<MiniRedeemResult>;
};
```

App 只调用 `loadWebConfig`；微信和百度只调用后两个方法。缺少对应方法时插件返回
`CAP_INVALID_ADAPTER`。

### App 配置

```js
const capAdapter = {
  /** 返回允许 App 客户端直接访问的 Cap API 根地址。 */
  async loadWebConfig({ platform, purpose, binding, requestId }) {
    return {
      apiEndpoint: "https://captcha.example.com/cap/site-key/",
      headers: {},
      // 生产必须保持 false，仅本地 HTTP 联调时才显式开启。
      allowInsecureHttpForDevelopment: false
    };
  }
};
```

`apiEndpoint` 只能访问其下的 `challenge` 和 `redeem`。生产默认只允许 HTTPS。
如需鉴权，`headers` 只能使用短期、低权限凭证，禁止放置 Cap secret、平台 secret
或长期业务令牌。

### 小程序 challenge

微信和百度必须先取得平台一次性 code，再由宿主后端验证 code，并代理固定的 Cap
challenge。客户端不得决定 Cap server 或 site key。

```js
const capAdapter = {
  async createMiniChallenge({
    platform,
    loginCode,
    purpose,
    binding,
    requestId,
    signal
  }) {
    return requestBackend("/cap/mini/challenge", {
      platform,
      loginCode,
      purpose,
      binding,
      requestId
    }, signal);
  },

  async redeemMiniChallenge({
    clientSessionId,
    solutions,
    signal
  }) {
    return requestBackend("/cap/mini/redeem", {
      clientSessionId,
      solutions
    }, signal);
  }
};
```

插件会把 `platform`、`purpose`、`binding` 和 `requestId` 一并提供给
`redeemMiniChallenge`，方便宿主做本地观测；但适配器不得把这些客户端字段作为
兑换授权依据，也不应重新发送给后端。后端只能依据创建 challenge 时保存的短期
会话恢复并校验平台、用途和业务绑定。

challenge 响应必须符合：

```ts
type MiniChallenge = {
  clientSessionId: string;
  protocol: "cap-pow-v1";
  challenges: Array<[salt: string, targetHexPrefix: string]>;
  expiresAt: string; // 必须是未来时间的 ISO 8601 字符串
};
```

redeem 响应必须符合：

```ts
type MiniRedeemResult = {
  captchaVerification: string;
  expiresAt: string; // 必须是未来时间的 ISO 8601 字符串
};
```

插件遇到 `instrumentation`、RSW、空挑战、过期挑战、上游 token 或未知 `protocol`
时会立即失败。微信、百度应分别使用关闭 instrumentation 的独立 Cap site key；
App 可使用开启 instrumentation 的 Web/App site key。

### 取消网络请求

`createMiniChallenge` 和 `redeemMiniChallenge` 的请求对象包含轻量 `signal`：

- `signal.cancelled`
- `signal.reason`
- `signal.onCancel(listener)`
- `signal.throwIfCancelled()`

`signal` 只供客户端取消控制，不得序列化或发送到后端。适配器必须在取消时终止
`uni.request`：

```js
function requestBackend(url, data, signal) {
  let removeCancel = () => {};
  return new Promise((resolve, reject) => {
    const requestTask = uni.request({
      url,
      method: "POST",
      data,
      success(result) {
        removeCancel();
        resolve(result.data);
      },
      fail(error) {
        removeCancel();
        reject(error);
      }
    });
    removeCancel = signal.onCancel((reason) => {
      requestTask.abort();
      reject(reason);
    });
  });
}
```

适配器也可以用非 `async` 方法返回 `{ promise, abort }`，插件会在取消和超时时
自动调用 `abort()`。

## 组件 API

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `adapter` | `Object` | 必填 | 宿主后端适配器 |
| `show-status` | `Boolean` | `true` | 是否渲染内置状态提示 |
| `timeout-ms` | `Number` | `30000` | 默认超时，允许 1000～120000ms |
| `weixin-worker-path` | `String` | 插件默认路径 | 微信 Worker 路径 |
| `weixin-wasm-path` | `String` | 插件默认路径 | 微信 WASM 路径 |

### 方法

- `verify({ purpose, binding, timeoutMs })`：开始验证；`purpose` 必填且最多 64 字符。
- `cancel()`：立即取消当前任务，返回是否存在活动任务。
- `reset()`：取消任务、清空结果并恢复 `idle`。

同一组件只允许一个验证任务，并发调用返回 `CAP_BUSY`。组件卸载、超时和取消都会
销毁 Worker/iframe，并清除 loginCode、clientSessionId 和最终票据。

### 状态事件

```ts
type CapStateEvent = {
  state: "idle" | "attesting" | "challenging" | "solving"
    | "redeeming" | "success" | "error" | "cancelled";
  platform: "app" | "wechat" | "baidu";
  progress: number;
  message: string;
  requestId: string;
  errorCode?: string;
};
```

`statechange` 适合驱动业务按钮、进度文案和错误提示。内置提示使用 `role="status"`
与 `aria-live="polite"`。

## 稳定错误码

- `CAP_INVALID_REQUEST`
- `CAP_INVALID_ADAPTER`
- `CAP_BUSY`
- `CAP_TIMEOUT`
- `CAP_CANCELLED`
- `CAP_UNSUPPORTED_PLATFORM`
- `CAP_PLATFORM_ATTESTATION_FAILED`
- `CAP_CHALLENGE_FAILED`
- `CAP_INVALID_CHALLENGE`
- `CAP_UNSUPPORTED_CHALLENGE`
- `CAP_SOLVE_FAILED`
- `CAP_REDEEM_FAILED`
- `CAP_APP_BRIDGE_FAILED`

错误对象的 `message` 可以展示给用户；请使用 `code` 做埋点和分支判断，不要解析
文案。

## App 本地资源

App 不访问 CDN，插件固定随附：

- `cap-widget@0.1.50`
- `@cap.js/wasm@0.0.7`
- `pako@2.1.0` inflate 构建

运行时目录是：

```text
./uni_modules/yinzon-uniapp-cap/hybrid/html/yinzon-uniapp-cap/
```

插件通过 `plus.io` 将本地 WASM 转成 Blob URL，兼容 WKWebView 对本地 `file://`
请求的限制。Cap challenge/redeem 使用 `plus.net.XMLHttpRequest`，不依赖 WebView
的 Origin/CORS。

每次验证运行在一次性同源 iframe 中。取消或卸载时直接销毁 browsing context，
从而终止 Cap 内部 Worker、instrumentation iframe、临时 DOM 和活动 XHR，取消后
不会继续 redeem。

## 百度未登录

百度宿主已登录时，`swan.getLoginCode` 通常会静默返回一次性 code；未登录时，
组件在当前位置显示 `open-type="login"` 按钮。用户点击后由百度 App 展示平台登录
界面，成功后继续验证，取消则停止本次任务。

该流程不是业务账号登录，不请求百度密码、手机号、昵称或头像。

## 服务端安全要求

- 平台 code 必须只在后端验证，且防止过期和重放。
- challenge 会话和业务票据必须短期、一次性，并绑定平台、purpose 与 binding。
- 后端必须固定 Cap server 和 site key，不能代理客户端传入的任意地址或 key。
- challenge、redeem 和业务接口均应频控；Redis、Cap 或平台服务故障时失败关闭。
- 业务接口必须在服务端消费 `captchaVerification`，不能让 App/Web token 和小程序
  票据互相降级。
- 不要记录平台 code、solution、票据、OpenID、session key 或长期身份凭据。

## 隐私说明

插件无广告，不申请新增系统权限。运行时只在内存中短暂处理微信或百度一次性 code、
Cap challenge/solution、App instrumentation 数据和最终票据，并仅发送到宿主通过
适配器配置的服务地址。插件不固定连接英纵服务器，不获取手机号、密码、昵称或头像，
也不把临时凭证写入 Storage 或日志。

最终的数据处理目的、服务器、保存周期和隐私政策由宿主应用负责向用户说明。

## 从 0.1.0 迁移

0.2.0 是完整重命名版本，不提供旧组件别名：

| 0.1.0 | 0.2.0 |
| --- | --- |
| `uni_modules/yinzon-cap` | `uni_modules/yinzon-uniapp-cap` |
| `<yinzon-cap>` | `<yinzon-uniapp-cap>` |
| `static/yinzon-cap` | `static/yinzon-uniapp-cap` |
| `hybrid/html/yinzon-cap` | `hybrid/html/yinzon-uniapp-cap` |

升级后必须同步更新 `manifest.json` 的微信 Worker 根目录和所有组件标签。公共方法、
事件、适配器协议不变。

## 开源许可与验证

插件采用 Apache License 2.0。第三方版本、许可证和 SHA-256 见
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

```bash
npm test
```

自动化测试之外，还应分别执行 HBuilderX Android、iOS、微信和百度编译，并在对应
开发者工具或真机验证资源加载、取消、弱网超时和最终业务票据消费。
