# 更新日志

## 0.2.0 - 2026-07-24

- 首次在 DCloud 插件市场公开发布，采用 Apache License 2.0。
- 插件 ID、安装目录和组件标签统一为 `yinzon-uniapp-cap`。
- 支持 Android/iOS App 内联 Cap Widget、微信 Worker/WASM 求解和百度分片
  JavaScript 求解。
- 提供宿主后端适配器、状态事件、取消、重置、单任务和超时控制。
- App 生产环境默认仅允许 HTTPS，小程序遇到未知协议或不支持的挑战时失败关闭。
- 固定随附 Cap Widget、Cap WASM 和 pako，并公开第三方版本、许可证与文件哈希。

### 从 0.1.0 迁移

- `uni_modules/yinzon-cap` 改为 `uni_modules/yinzon-uniapp-cap`。
- `<yinzon-cap>` 改为 `<yinzon-uniapp-cap>`，不提供旧标签兼容层。
- 微信 Worker、WASM 和 App hybrid 资源目录同步改为 `yinzon-uniapp-cap`。
- `verify()`、`cancel()`、`reset()`、`statechange` 和适配器协议保持不变。
