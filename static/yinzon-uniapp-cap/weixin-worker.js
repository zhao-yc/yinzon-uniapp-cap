/* yinzon-uniapp-cap 微信 Worker：固定使用 @cap.js/wasm 0.0.7，WASM 不可用时失败关闭。 */
(function () {
  var scope = typeof worker !== "undefined" ? worker : self;
  var cancelled = false;
  var wasmExports = null;
  var wasmInitPromise = null;
  var WASM_VECTOR_LEN = 0;
  var cachedMemory = null;

  function postMessageSafe(message) {
    scope.postMessage(message);
  }

  function bindMessage(handler) {
    if (typeof scope.onMessage === "function") scope.onMessage(handler);
    else scope.onmessage = function (event) { handler(event.data); };
  }

  function encoder() {
    if (typeof TextEncoder === "function") return new TextEncoder();
    return {
      encode: function (value) {
        var encoded = unescape(encodeURIComponent(String(value)));
        var bytes = new Uint8Array(encoded.length);
        for (var index = 0; index < encoded.length; index += 1) bytes[index] = encoded.charCodeAt(index);
        return bytes;
      }
    };
  }

  var textEncoder = encoder();

  function memoryBytes() {
    if (!cachedMemory || cachedMemory.byteLength === 0) cachedMemory = new Uint8Array(wasmExports.memory.buffer);
    return cachedMemory;
  }

  function passStringToWasm(value, malloc, realloc) {
    var length = value.length;
    var pointer = malloc(length, 1) >>> 0;
    var memory = memoryBytes();
    var offset = 0;
    for (; offset < length; offset += 1) {
      var code = value.charCodeAt(offset);
      if (code > 127) break;
      memory[pointer + offset] = code;
    }
    if (offset !== length) {
      if (offset !== 0) value = value.slice(offset);
      pointer = realloc(pointer, length, length = offset + value.length * 3, 1) >>> 0;
      var encoded = textEncoder.encode(value);
      memoryBytes().subarray(pointer + offset, pointer + offset + encoded.length).set(encoded);
      offset += encoded.length;
      pointer = realloc(pointer, length, offset, 1) >>> 0;
    }
    WASM_VECTOR_LEN = offset;
    return pointer;
  }

  function createImports() {
    var imports = { wbg: {} };
    imports.wbg.__wbindgen_init_externref_table = function () {
      var table = wasmExports.__wbindgen_export_0;
      var offset = table.grow(4);
      table.set(0, undefined);
      table.set(offset + 0, undefined);
      table.set(offset + 1, null);
      table.set(offset + 2, true);
      table.set(offset + 3, false);
    };
    return imports;
  }

  /** 初始化微信 WASM；路径由逻辑层传入且必须属于小程序代码包。 */
  function initWasm(wasmPath) {
    if (wasmExports) return Promise.resolve(wasmExports);
    if (wasmInitPromise) return wasmInitPromise;
    var wasmApi = typeof WXWebAssembly !== "undefined" ? WXWebAssembly : null;
    if (!wasmApi || typeof wasmApi.instantiate !== "function") return Promise.reject(new Error("WXWebAssembly unavailable"));
    wasmInitPromise = Promise.resolve(wasmApi.instantiate(wasmPath, createImports()))
      .then(function (result) {
        var instance = result && result.instance ? result.instance : result;
        if (!instance || !instance.exports) throw new Error("Invalid WASM instance");
        wasmExports = instance.exports;
        cachedMemory = null;
        if (wasmExports.__wbindgen_start) wasmExports.__wbindgen_start();
        return wasmExports;
      })
      .catch(function (error) {
        wasmInitPromise = null;
        throw error;
      });
    return wasmInitPromise;
  }

  function solveWithWasm(salt, target) {
    var saltPointer = passStringToWasm(salt, wasmExports.__wbindgen_malloc, wasmExports.__wbindgen_realloc);
    var saltLength = WASM_VECTOR_LEN;
    var targetPointer = passStringToWasm(target, wasmExports.__wbindgen_malloc, wasmExports.__wbindgen_realloc);
    var targetLength = WASM_VECTOR_LEN;
    var raw = wasmExports.solve_pow(saltPointer, saltLength, targetPointer, targetLength);
    return Number(typeof BigInt === "function" ? BigInt.asUintN(64, raw) : raw);
  }

  var K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);

  function rotateRight(value, bits) { return (value >>> bits) | (value << (32 - bits)); }

  function sha256(value) {
    var input = textEncoder.encode(value);
    var bitLength = input.length * 8;
    var paddedLength = Math.ceil((input.length + 9) / 64) * 64;
    var bytes = new Uint8Array(paddedLength);
    bytes.set(input);
    bytes[input.length] = 0x80;
    var view = new DataView(bytes.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);
    var state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var words = new Uint32Array(64);
    for (var block = 0; block < paddedLength; block += 64) {
      var index;
      for (index = 0; index < 16; index += 1) words[index] = view.getUint32(block + index * 4, false);
      for (index = 16; index < 64; index += 1) {
        var wa = words[index - 15];
        var wb = words[index - 2];
        words[index] = (words[index - 16] + (rotateRight(wa,7)^rotateRight(wa,18)^(wa>>>3)) + words[index - 7] + (rotateRight(wb,17)^rotateRight(wb,19)^(wb>>>10))) >>> 0;
      }
      var a=state[0],b=state[1],c=state[2],d=state[3],e=state[4],f=state[5],g=state[6],h=state[7];
      for (index = 0; index < 64; index += 1) {
        var temp1=(h+(rotateRight(e,6)^rotateRight(e,11)^rotateRight(e,25))+((e&f)^(~e&g))+K[index]+words[index])>>>0;
        var temp2=((rotateRight(a,2)^rotateRight(a,13)^rotateRight(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
        h=g;g=f;f=e;e=(d+temp1)>>>0;d=c;c=b;b=a;a=(temp1+temp2)>>>0;
      }
      state[0]=(state[0]+a)>>>0;state[1]=(state[1]+b)>>>0;state[2]=(state[2]+c)>>>0;state[3]=(state[3]+d)>>>0;
      state[4]=(state[4]+e)>>>0;state[5]=(state[5]+f)>>>0;state[6]=(state[6]+g)>>>0;state[7]=(state[7]+h)>>>0;
    }
    var output = new Uint8Array(32);
    var outputView = new DataView(output.buffer);
    for (var outputIndex = 0; outputIndex < state.length; outputIndex += 1) outputView.setUint32(outputIndex * 4, state[outputIndex], false);
    return output;
  }

  function matches(hash, target) {
    var fullBytes = Math.floor(target.length / 2);
    for (var index = 0; index < fullBytes; index += 1) {
      if (hash[index] !== parseInt(target.slice(index * 2, index * 2 + 2), 16)) return false;
    }
    return target.length % 2 === 0 || (hash[fullBytes] >>> 4) === parseInt(target[target.length - 1], 16);
  }

  function solveWithJs(salt, target) {
    for (var nonce = 0; nonce < Number.MAX_SAFE_INTEGER; nonce += 1) {
      if (cancelled) throw new Error("cancelled");
      if (matches(sha256(salt + nonce), target)) return nonce;
    }
    throw new Error("No solution");
  }

  /** 每个 Worker 串行计算，避免在低端机开启多线程竞争。 */
  function solveAll(message) {
    cancelled = false;
    var challenges = Array.isArray(message.challenges) ? message.challenges : [];
    return initWasm(message.wasmPath)
      .then(function () {
        var solutions = [];
        for (var index = 0; index < challenges.length; index += 1) {
          if (cancelled) throw new Error("cancelled");
          var pair = challenges[index];
          solutions.push(solveWithWasm(pair[0], pair[1]));
          postMessageSafe({ type: "progress", progress: Math.min(99, Math.round(((index + 1) / challenges.length) * 100)) });
        }
        postMessageSafe({ type: "result", solutions: solutions });
      });
  }

  bindMessage(function (message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "cancel") {
      cancelled = true;
      return;
    }
    if (message.type !== "solve") return;
    solveAll(message).catch(function (error) {
      var cancelledError = error && error.message === "cancelled";
      var wasmError = error && String(error.message || "").indexOf("WASM") >= 0;
      postMessageSafe({
        type: "error",
        code: cancelledError ? "CAP_CANCELLED" : (wasmError ? "CAP_WASM_UNAVAILABLE" : "CAP_SOLVE_FAILED")
      });
    });
  });
})();
