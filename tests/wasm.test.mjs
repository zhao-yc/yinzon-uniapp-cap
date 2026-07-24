import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { hashMatchesTarget, sha256Bytes, solveChallengeChunked } from "../js_sdk/index.js";

async function loadCapWasmSolver() {
  const binary = await readFile(
    new URL("../hybrid/html/yinzon-uniapp-cap/cap_wasm_bg.wasm", import.meta.url)
  );
  let wasmExports = null;
  let vectorLength = 0;
  let cachedMemory = null;
  const imports = { wbg: {} };
  imports.wbg.__wbindgen_init_externref_table = () => {
    const table = wasmExports.__wbindgen_export_0;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
  };
  const { instance } = await WebAssembly.instantiate(binary, imports);
  wasmExports = instance.exports;
  wasmExports.__wbindgen_start?.();

  const memory = () => {
    if (!cachedMemory || cachedMemory.byteLength === 0) cachedMemory = new Uint8Array(wasmExports.memory.buffer);
    return cachedMemory;
  };
  const encoder = new TextEncoder();
  const passString = (value) => {
    const bytes = encoder.encode(value);
    const pointer = wasmExports.__wbindgen_malloc(bytes.length, 1) >>> 0;
    memory().subarray(pointer, pointer + bytes.length).set(bytes);
    vectorLength = bytes.length;
    return pointer;
  };

  return (salt, target) => {
    const saltPointer = passString(salt);
    const saltLength = vectorLength;
    const targetPointer = passString(target);
    const targetLength = vectorLength;
    return Number(BigInt.asUintN(64, wasmExports.solve_pow(saltPointer, saltLength, targetPointer, targetLength)));
  };
}

test("固定 WASM 0.0.7 与 JS 求解得到同一首个 nonce", async () => {
  const solveWasm = await loadCapWasmSolver();
  for (const [salt, target] of [["salt", "0"], ["85395707", "4b"], ["d54df4b5", "28"]]) {
    const wasmNonce = solveWasm(salt, target);
    const jsNonce = await solveChallengeChunked([salt, target], { sliceMs: 4 });
    assert.equal(wasmNonce, jsNonce);
    assert.equal(hashMatchesTarget(sha256Bytes(`${salt}${wasmNonce}`), target), true);
  }
});
