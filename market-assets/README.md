# `yinzon-uniapp-cap` 市场素材

## 目录

- `example/`：经典 uni-app Vue 3 最小示例工程。
- `preview/market-preview.png`：DCloud 市场预览图，1080×1440。
- `preview/market-preview.svg`：可继续编辑的预览图源稿。
- `scripts/check-example.mjs`：示例和预览图静态检查。

## 发布前准备

示例工程不复制插件源码。上传示例项目前，先通过 HBuilderX 从插件市场导入
`yinzon-uniapp-cap`，或将待发布插件复制到：

```text
example/uni_modules/yinzon-uniapp-cap
```

随后执行：

```bash
node scripts/check-example.mjs
```

示例默认不会连接任何后端。只有接入者实现 `example/common/cap-adapter.js`
并显式将 `CAP_BACKEND_CONFIGURED` 改为 `true` 后，页面才会调用组件验证。
