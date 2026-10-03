// A very small CDP client: launches headless Chromium, drives it over the
// DevTools WebSocket, and dispatches REAL touch events. No dependencies - Node
// has had a global WebSocket since 22, and that is all this needs.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSERS = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];

async function waitFor(fn, ms, what) {
  const until = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* not ready */ }
    if (Date.now() > until) throw new Error("timed out waiting for " + what);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function launch({ width = 390, height = 844 } = {}) {
  const { existsSync } = await import("node:fs");
  const bin = BROWSERS.find((b) => existsSync(b));
  if (!bin) throw new Error("no chromium binary");
  const profile = await mkdtemp(join(tmpdir(), "mototrack-cdp-"));
  const port = 9000 + Math.floor(Math.random() * 900);
  const child = spawn(bin, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
    "--remote-debugging-port=" + port, "--user-data-dir=" + profile,
    "--window-size=" + width + "," + height, "about:blank",
  ], { stdio: "ignore" });

  const target = await waitFor(async () => {
    const res = await fetch("http://127.0.0.1:" + port + "/json/list");
    const list = await res.json();
    return list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  }, 20000, "the debugger");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send("Page.enable");
  await send("Runtime.enable");
  // A real touch device: this is what makes the browser capture the pointer
  // implicitly on the child under the finger, which is the bug being tested.
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setEmitTouchEventsForMouse", { enabled: false });
  await send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 0, mobile: true,
  });

  const api = {
    async goto(url) {
      await send("Page.navigate", { url });
      await waitFor(async () => (await api.eval("document.readyState")) === "complete", 15000, "load");
    },
    async eval(expression) {
      const r = await send("Runtime.evaluate", {
        expression: "(function(){ return (" + expression + "); })()",
        returnByValue: true, awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + expression);
      return r.result.value;
    },
    async run(statements) {
      const r = await send("Runtime.evaluate", {
        expression: "(function(){ " + statements + " })()",
        returnByValue: true, awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    },
    touch(type, points) {
      return send("Input.dispatchTouchEvent", { type, touchPoints: points });
    },
    async drag(x, y, dx, steps = 10) {
      await api.touch("touchStart", [{ x, y, id: 1 }]);
      for (let i = 1; i <= steps; i += 1) {
        await api.touch("touchMove", [{ x: x + (dx * i) / steps, y, id: 1 }]);
        await new Promise((r) => setTimeout(r, 12));
      }
      await api.touch("touchEnd", []);
    },
    async close() {
      try { ws.close(); } catch (e) { /* already gone */ }
      child.kill("SIGKILL");
      await rm(profile, { recursive: true, force: true });
    },
  };
  return api;
}
