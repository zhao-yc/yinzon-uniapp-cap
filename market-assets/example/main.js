import App from "./App";
import { createSSRApp } from "vue";

/**
 * 创建经典 uni-app Vue 3 应用实例。
 */
export function createApp() {
  const app = createSSRApp(App);
  return { app };
}
