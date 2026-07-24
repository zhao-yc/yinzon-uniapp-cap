# 英纵 uni-app Cap 安全验证示例

这是 `yinzon-uniapp-cap` 的最小经典 uni-app Vue 3 示例工程，支持 App、微信小程序和百度小程序。

## 使用方式

1. 从 DCloud 插件市场导入 `yinzon-uniapp-cap`，确认目录为
   `uni_modules/yinzon-uniapp-cap`。
2. 在 `common/cap-adapter.js` 中实现自己的宿主后端适配器。
3. 实现完成后，将 `CAP_BACKEND_CONFIGURED` 改为 `true`。
4. 在 HBuilderX 中运行到对应平台。

示例默认不连接任何网络服务。点击“开始安全验证”会明确提示“示例尚未配置宿主后端”，不会获取平台 code，也不会伪造成功票据。

## 必须由宿主实现

- App：返回允许客户端访问的 Cap API 根地址和短期请求头。
- 微信/百度：平台 code 校验、Cap challenge 代理、solution 兑换。
- 业务后端：校验并消费一次性票据，绑定平台、purpose 和业务 binding。

不要把平台 secret、Cap secret、生产域名或长期凭证写进客户端。

## 微信 Worker

`manifest.json` 已声明：

```json
{
  "mp-weixin": {
    "workers": "uni_modules/yinzon-uniapp-cap/static/yinzon-uniapp-cap"
  }
}
```

构建后还需在微信开发者工具中确认 `app.json` 的 `workers` 字段，以及
`weixin-worker.js`、`cap_wasm_bg.wasm` 均已进入产物。

## 组件调用

```vue
<yinzon-uniapp-cap
  ref="capVerifier"
  :adapter="capAdapter"
  @statechange="handleCapState"
/>
```

```js
const result = await this.$refs.capVerifier.verify({
  purpose: "market_demo",
  binding: {
    resourceId: "demo_resource_001"
  }
});
```
