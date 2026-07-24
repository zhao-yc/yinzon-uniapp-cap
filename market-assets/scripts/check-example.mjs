import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const exampleDirectory = path.join(rootDirectory, "example");
const requiredFiles = [
  "App.vue",
  "main.js",
  "manifest.json",
  "pages.json",
  "common/cap-adapter.js",
  "pages/index/index.vue",
  "README.md"
];
const forbiddenPatterns = [
  /https?:\/\//i,
  /\bappid\b\s*["']?\s*[:=]\s*["'][^"']+["']/i,
  /\bsite[_-]?key\b\s*["']?\s*[:=]\s*["'][^"']+["']/i,
  /\b(?:app|client|cap)?[_-]?secret\b\s*["']?\s*[:=]\s*["'][^"']+["']/i,
  /baozufang/i,
  /保租房/,
  /<yinzon-cap(?:\s|>)/,
  /uni_modules\/yinzon-cap(?:\/|["'])/
];

/**
 * 递归收集示例中的文本文件。
 */
async function collectTextFiles(directory, relativeDirectory = "") {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTextFiles(absolutePath, relativePath)));
      continue;
    }
    if (/\.(?:js|json|md|vue|scss|html)$/i.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

/**
 * 检查示例文件存在且不包含业务配置或真实服务地址。
 */
async function validateExample() {
  for (const relativePath of requiredFiles) {
    const fileStat = await stat(path.join(exampleDirectory, relativePath));
    if (!fileStat.isFile() || fileStat.size === 0) {
      throw new Error(`示例文件无效：${relativePath}`);
    }
  }

  const textFiles = await collectTextFiles(exampleDirectory);
  const sources = await Promise.all(
    textFiles.map(async (relativePath) => ({
      relativePath,
      source: await readFile(path.join(exampleDirectory, relativePath), "utf8")
    }))
  );
  const pageSource = sources.find(
    ({ relativePath }) => relativePath === "pages/index/index.vue"
  )?.source;
  if (!pageSource?.includes("<yinzon-uniapp-cap")) {
    throw new Error("示例未使用 <yinzon-uniapp-cap> 组件标签");
  }

  const adapterSource = sources.find(
    ({ relativePath }) => relativePath === "common/cap-adapter.js"
  )?.source;
  if (
    !adapterSource?.includes("CAP_BACKEND_NOT_CONFIGURED") ||
    !adapterSource?.includes("throw createBackendNotConfiguredError")
  ) {
    throw new Error("示例适配器没有明确失败关闭");
  }

  for (const { relativePath, source } of sources) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(source)) {
        throw new Error(`示例包含禁止内容：${relativePath} / ${pattern}`);
      }
    }
  }
}

/**
 * 读取 PNG IHDR，校验市场图尺寸和体积。
 */
async function validatePreview() {
  const previewPath = path.join(rootDirectory, "preview", "market-preview.png");
  const previewStat = await stat(previewPath);
  if (previewStat.size >= 1024 * 1024) {
    throw new Error(`市场预览图超过 1MB：${previewStat.size} bytes`);
  }
  const header = await readFile(previewPath);
  const pngSignature = "89504e470d0a1a0a";
  if (header.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error("市场预览图不是有效 PNG");
  }
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  if (width < 480 || height < 800) {
    throw new Error(`市场预览图尺寸不足：${width}x${height}`);
  }
  console.log(`市场预览图检查通过：${width}x${height}，${previewStat.size} bytes。`);
}

await validateExample();
console.log("示例静态检查通过：组件标签、失败关闭和敏感配置均符合要求。");
await validatePreview();
