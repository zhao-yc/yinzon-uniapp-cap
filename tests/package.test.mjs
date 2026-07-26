import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);

/** 从 renderjs 段加载纯函数，并注入可控的 plus.io 浏览器环境。 */
async function loadRenderHelpers(overrides = {}) {
  const component = await readFile(
    new URL("components/yinzon-uniapp-cap/yinzon-uniapp-cap.vue", ROOT),
    "utf8"
  );
  const start = component.indexOf("const CAP_WIDGET_VERSION =");
  const end = component.indexOf("\nexport default {", start);
  assert.ok(start >= 0 && end > start, "应能定位 renderjs 实现");
  const context = {
    Blob,
    Uint8Array,
    atob,
    clearTimeout,
    setTimeout,
    URL,
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(`${component.slice(start, end)}\n;globalThis.__capTest = {
    destroyFrame,
    loadLocalWasmBlobUrl,
    resolveAllowedCapUrl,
    getResourceGeneration: () => activeResourceGeneration,
    getActiveWasmUrl: () => activeWasmUrl
  };`, context);
  return context.__capTest;
}

test("uni_modules 元数据和 easycom 组件契约完整", async () => {
  const manifest = JSON.parse(await readFile(new URL("package.json", ROOT), "utf8"));
  const component = await readFile(
    new URL("components/yinzon-uniapp-cap/yinzon-uniapp-cap.vue", ROOT),
    "utf8"
  );
  assert.equal(manifest.id, "yinzon-uniapp-cap");
  assert.equal(manifest.name, "yinzon-uniapp-cap");
  assert.equal(manifest.displayName, "英纵 uni-app Cap 安全验证");
  assert.equal(manifest.version, "0.2.2");
  assert.deepEqual(manifest.engines, {
    HBuilderX: ">=5.15.0",
    "uni-app": "^5.15"
  });
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(Object.hasOwn(manifest, "private"), false);
  assert.equal(manifest.dcloudext.type, "component-vue");
  assert.deepEqual(manifest.dcloudext.category, ["前端组件", "通用组件"]);
  assert.equal(manifest.dcloudext.sale.regular.price, "0.00");
  assert.equal(manifest.dcloudext.darkmode, "x");
  assert.equal(manifest.dcloudext.i18n, "x");
  assert.equal(manifest.dcloudext.widescreen, "√");
  assert.equal(manifest.uni_modules.platforms.client["uni-app"].vue.vue2, "x");
  assert.equal(manifest.uni_modules.platforms.client["uni-app"].vue.vue3, "√");
  assert.equal(manifest.uni_modules.platforms.client["uni-app"].app.android, "√");
  assert.equal(manifest.uni_modules.platforms.client["uni-app"].app.ios, "√");
  assert.equal(manifest.uni_modules.platforms.client["uni-app"].mp.weixin, "√");
  assert.equal(manifest.uni_modules.platforms.client["uni-app"].mp.baidu, "√");
  assert.equal(manifest.uni_modules.platforms.client["uni-app-x"].app.android, "x");
  assert.ok(manifest.files.includes("components/"));
  assert.equal(component.includes('name: "YinzonUniappCap"'), true);
  assert.match(component, /async verify\(options = \{\}\)/);
  assert.match(component, /cancel\(\)/);
  assert.match(component, /reset\(\)/);
  assert.match(component, /this\.\$emit\("statechange", detail\)/);
  assert.match(component, /platform = "wechat"/);
  assert.match(component, /open-type="login"/);
});

test("App 固定使用本地 Widget、WASM 和 pako", async () => {
  const component = await readFile(
    new URL("components/yinzon-uniapp-cap/yinzon-uniapp-cap.vue", ROOT),
    "utf8"
  );
  assert.match(component, /CAP_WIDGET_VERSION = "0\.1\.50"/);
  assert.match(component, /CAP_WASM_VERSION = "0\.0\.7"/);
  assert.match(component, /PAKO_VERSION = "2\.1\.0"/);
  assert.match(
    component,
    /\.\/uni_modules\/yinzon-uniapp-cap\/hybrid\/html\/yinzon-uniapp-cap\/cap\.min\.js/
  );
  assert.match(component, /frameWindow\.CAP_CUSTOM_WASM_URL = wasmBlobUrl/);
  assert.match(component, /frameWindow\.CAP_PAKO_URL = PAKO_URL/);
  assert.match(component, /new plus\.net\.XMLHttpRequest\(\)/);
  assert.match(component, /xhr\.abort\(\)/);
  assert.match(component, /loadLocalWasmBlobUrl/);
  assert.match(component, /resourceGeneration !== activeResourceGeneration \|\| activeWasmReader !== reader/);
  assert.match(component, /URL\.createObjectURL\(new Blob/);
  assert.doesNotMatch(component, /https?:\/\/cdn\./);

  const widget = await stat(new URL("hybrid/html/yinzon-uniapp-cap/cap.min.js", ROOT));
  const wasm = await stat(new URL("hybrid/html/yinzon-uniapp-cap/cap_wasm_bg.wasm", ROOT));
  const pako = await stat(new URL("hybrid/html/yinzon-uniapp-cap/pako_inflate.min.js", ROOT));
  assert.ok(widget.size > 30000);
  assert.ok(wasm.size > 20000);
  assert.ok(pako.size > 20000);
});

test("App 取消通过销毁 iframe 终止 Worker 且不会继续回传", async () => {
  const component = await readFile(
    new URL("components/yinzon-uniapp-cap/yinzon-uniapp-cap.vue", ROOT),
    "utf8"
  );
  assert.match(component, /function destroyFrame\(\)/);
  assert.match(component, /new MutationObserver/);
  assert.match(component, /if \(!host\.isConnected\) destroyFrame\(\)/);
  assert.match(component, /frame\.src = "about:blank"/);
  assert.match(component, /frame\.remove\(\)/);
  assert.match(component, /host\.appendChild\(frame\)/);
  assert.doesNotMatch(component, /document\.body\.appendChild\(frame\)/);
  assert.match(component, /activeRequestId !== requestId/);
  assert.match(component, /type === "cancel" \|\| type === "reset" \|\| type === "destroy"/);
});

test("App plus.io 旧代际回调不会创建或覆盖新任务资源", async () => {
  const filesystemCallbacks = [];
  const fileCallbacks = [];
  let readerCount = 0;
  let blobSequence = 0;
  const revoked = [];
  class MockFileReader {
    readAsDataURL() {
      this.onloadend?.({ target: { result: "data:application/wasm;base64,AQID" } });
    }
    abort() {}
  }
  class MockURL extends URL {}
  MockURL.createObjectURL = () => `blob:test-${++blobSequence}`;
  MockURL.revokeObjectURL = (value) => revoked.push(value);
  const plus = {
    io: {
      resolveLocalFileSystemURL(path, success, fail) {
        filesystemCallbacks.push({ path, success, fail });
      },
      FileReader: class extends MockFileReader {
        constructor() {
          super();
          readerCount += 1;
        }
      }
    }
  };
  const helpers = await loadRenderHelpers({ plus, URL: MockURL });

  helpers.destroyFrame();
  const oldGeneration = helpers.getResourceGeneration();
  const oldLoad = helpers.loadLocalWasmBlobUrl(oldGeneration);
  const oldRejected = assert.rejects(oldLoad, /已取消/);
  filesystemCallbacks.shift().success({
    file(success, fail) { fileCallbacks.push({ success, fail }); }
  });

  // reset 淘汰旧任务后立即开始新任务，再让旧 entry.file 回调晚到。
  helpers.destroyFrame();
  const newGeneration = helpers.getResourceGeneration();
  const newLoad = helpers.loadLocalWasmBlobUrl(newGeneration);
  fileCallbacks.shift().success({});
  filesystemCallbacks.shift().success({
    file(success) { success({}); }
  });

  await oldRejected;
  assert.equal(await newLoad, "blob:test-1");
  assert.equal(readerCount, 1);
  assert.equal(helpers.getActiveWasmUrl(), "blob:test-1");
  helpers.destroyFrame();
  assert.deepEqual(revoked, ["blob:test-1"]);
});

test("App Cap endpoint 生产仅允许 HTTPS，HTTP 必须显式开发态开启", async () => {
  const helpers = await loadRenderHelpers();
  assert.equal(
    helpers.resolveAllowedCapUrl("challenge", "https://cap.example.test/site/"),
    "https://cap.example.test/site/challenge"
  );
  assert.throws(
    () => helpers.resolveAllowedCapUrl("challenge", "http://127.0.0.1:8073/cap/"),
    /协议无效/
  );
  assert.equal(
    helpers.resolveAllowedCapUrl("redeem", "http://127.0.0.1:8073/cap/", true),
    "http://127.0.0.1:8073/cap/redeem"
  );
  assert.throws(
    () => helpers.resolveAllowedCapUrl("challenge", "javascript:alert(1)", true),
    /协议无效/
  );
  assert.throws(
    () => helpers.resolveAllowedCapUrl("../other", "https://cap.example.test/site/"),
    /越界/
  );
});

test("微信 Worker 默认严格要求 WXWebAssembly", async () => {
  const solver = await readFile(new URL("js_sdk/solvers/weixin.js", ROOT), "utf8");
  const worker = await readFile(new URL("static/yinzon-uniapp-cap/weixin-worker.js", ROOT), "utf8");
  assert.match(solver, /options\.allowJsFallback !== true/);
  assert.match(worker, /WXWebAssembly/);
  assert.match(worker, /solutions\.push\(solveWithWasm/);
  assert.doesNotMatch(worker, /catch\(function \(\) \{ return null; \}\)/);
});

test("公开许可证、市场文档和第三方声明齐全", async () => {
  const readme = await readFile(new URL("readme.md", ROOT), "utf8");
  const notices = await readFile(new URL("THIRD_PARTY_NOTICES.md", ROOT), "utf8");
  const license = await readFile(new URL("LICENSE", ROOT), "utf8");
  const npmignore = await readFile(new URL(".npmignore", ROOT), "utf8");
  await stat(new URL("license.md", ROOT));
  await stat(new URL("NOTICE", ROOT));
  await stat(new URL("hybrid/html/yinzon-uniapp-cap/LICENSE-CAP.txt", ROOT));
  await stat(new URL("hybrid/html/yinzon-uniapp-cap/LICENSE-PAKO.txt", ROOT));
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(readme, /从 DCloud 插件市场/);
  assert.match(
    readme,
    /"workers": "uni_modules\/yinzon-uniapp-cap\/static\/yinzon-uniapp-cap"/
  );
  assert.match(readme, /<yinzon-uniapp-cap/);
  assert.match(readme, /expiresAt: string; \/\/ 必须是未来时间/);
  assert.doesNotMatch(readme, /expiresAt\?: string|expiresAt: "\.\.\." \| null/);
  assert.match(readme, /signal\.onCancel/);
  assert.match(readme, /不固定连接英纵服务器/);
  assert.match(npmignore, /^tests\/$/m);
  assert.match(notices, /cap-widget/);
  assert.match(notices, /pako/);
  assert.match(notices, /MIT AND Zlib/);
});

test("Vue 2/3 卸载钩子共用幂等清理入口", async () => {
  const component = await readFile(
    new URL("components/yinzon-uniapp-cap/yinzon-uniapp-cap.vue", ROOT),
    "utf8"
  );
  assert.match(component, /beforeUnmount\(\) \{\s*this\._teardownCap\(\)/);
  assert.match(component, /beforeDestroy\(\) \{\s*this\._teardownCap\(\)/);
});

test("运行时代码已完整迁移且不保留旧组件标识", async () => {
  const runtimeFiles = [
    "components/yinzon-uniapp-cap/yinzon-uniapp-cap.vue",
    "js_sdk/solvers/weixin.js",
    "static/yinzon-uniapp-cap/weixin-worker.js"
  ];
  const runtime = (
    await Promise.all(runtimeFiles.map((file) => readFile(new URL(file, ROOT), "utf8")))
  ).join("\n");
  assert.doesNotMatch(runtime, /yinzon-cap|YinzonCap/);
  assert.match(runtime, /yinzon-uniapp-cap/);
  assert.match(runtime, /YinzonUniappCap/);
});

test("第三方二进制哈希与公开声明一致", async () => {
  const expected = new Map([
    ["hybrid/html/yinzon-uniapp-cap/cap.min.js", "ba3c9cf8831666789f337514ee9e830b9400e8be5d80f8f81f5fb95af5808912"],
    ["hybrid/html/yinzon-uniapp-cap/cap_wasm_bg.wasm", "e4f3c00246a775193661f9277ca1288cd310a6514de166ecc2176ccd26fb06a9"],
    ["static/yinzon-uniapp-cap/cap_wasm_bg.wasm", "e4f3c00246a775193661f9277ca1288cd310a6514de166ecc2176ccd26fb06a9"],
    ["hybrid/html/yinzon-uniapp-cap/pako_inflate.min.js", "fa226c8e1e3556993260e6a5c1fe94e225da59b3418a06811fdc51d308f8bb43"]
  ]);
  for (const [file, hash] of expected) {
    const content = await readFile(new URL(file, ROOT));
    assert.equal(createHash("sha256").update(content).digest("hex"), hash);
  }
});
