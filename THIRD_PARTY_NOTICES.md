# 第三方软件说明

本插件固定随附以下第三方文件，运行时不会从 CDN 下载。这些文件已与对应 npm
发布包逐字节核对，均未修改。

## Cap Widget

- 组件：`cap-widget`
- 固定版本：`0.1.50`
- 来源：https://github.com/tiagozip/cap
- 许可证：Apache License 2.0
- 本地文件：`hybrid/html/yinzon-uniapp-cap/cap.min.js`
- SHA-256：`ba3c9cf8831666789f337514ee9e830b9400e8be5d80f8f81f5fb95af5808912`

## Cap WASM

- 组件：`@cap.js/wasm`
- 固定版本：`0.0.7`
- 来源：https://github.com/tiagozip/cap
- 许可证：Apache License 2.0
- 本地文件：
  - `hybrid/html/yinzon-uniapp-cap/cap_wasm_bg.wasm`
  - `static/yinzon-uniapp-cap/cap_wasm_bg.wasm`
- 两个文件的 SHA-256：`e4f3c00246a775193661f9277ca1288cd310a6514de166ecc2176ccd26fb06a9`

Cap Widget 与 Cap WASM 的许可证全文位于
`hybrid/html/yinzon-uniapp-cap/LICENSE-CAP.txt`。

## pako

- 组件：`pako`
- 固定版本：`2.1.0`
- 来源：https://github.com/nodeca/pako
- 许可证：MIT AND Zlib
- 本地文件：`hybrid/html/yinzon-uniapp-cap/pako_inflate.min.js`
- SHA-256：`fa226c8e1e3556993260e6a5c1fe94e225da59b3418a06811fdc51d308f8bb43`
- 许可证全文：`hybrid/html/yinzon-uniapp-cap/LICENSE-PAKO.txt`

发布包内文件应以此文档列出的完整 SHA-256 值进行校验。
