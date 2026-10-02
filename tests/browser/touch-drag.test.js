// Opt-in: real touch events against a real browser. The stub DOM cannot show
// this bug, because implicit pointer capture only happens on touch and only
// in a real engine. Run with BROWSER_TESTS=1.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { launch } from "../helpers/cdp.js";

const ENABLED = process.env.BROWSER_TESTS === "1";
const ROOT = join(import.meta.dirname, "..", "..", "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".svg": "image/svg+xml", ".json": "application/json" };

async function serve() {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch (e) { res.writeHead(404); res.end("not found"); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

const SEED = `localStorage.setItem('mototrack.sessions.v1', JSON.stringify([{
  id:'s', savedAt:'2026-09-27T10:00:00.000Z', sessionLabel:'Session 2',
  setup:{bike:'B', track:'T'},
  tires:{brand:'P', model:'M', frontPre:'31.0', rearPre:'28.0'},
  suspension:{}, laps:{}, riderFeedback:{}}]));`;

const SET = (id, v) => `var e=document.getElementById('${id}');e.value=${JSON.stringify(v)};` +
  `e.dispatchEvent(new Event('input',{bubbles:true}));`;

test("a real touch drag of 5 notches moves the value by 0.5", { skip: !ENABLED }, async (t) => {
  const { server, port } = await serve();
  const b = await launch({ width: 390, height: 844 });
  t.after(async () => { await b.close(); server.close(); });

  const url = `http://127.0.0.1:${port}/log/`;
  await b.goto(url);
  await b.run("localStorage.clear(); " + SEED);
  await b.goto(url);
  await b.run(SET("bike", "B") + SET("track", "T") + SET("session-label", "Session 3"));
  await b.run("document.getElementById('dock-advance').click();");
  await b.run(SET("tire-brand", "P") + SET("tire-model", "M"));
  await b.run(SET("front-pre", "30.0"));
  await new Promise((r) => setTimeout(r, 300));

  // The pad must be on screen for the touch coordinates to land on it.
  await b.run("document.getElementById('front-pre-pad').scrollIntoView({block:'center'});");
  await new Promise((r) => setTimeout(r, 200));

  const box = await b.eval(`(function(){var r=document.getElementById('front-pre-pad').getBoundingClientRect();
    return {x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), w: Math.round(r.width)};})()`);
  assert.ok(box.w > 60, "the pad is laid out");

  // Dragging LEFT increases. 5 notches at 24px each.
  await b.drag(box.x + 60, box.y, -5 * 24);
  await new Promise((r) => setTimeout(r, 200));

  const after = await b.eval("document.getElementById('front-pre').value");
  assert.equal(after, "30.5", "five notches left is +0.5 PSI");
});

test("a vertical touch drag that starts on the pad scrolls instead of changing the value",
  { skip: !ENABLED }, async (t) => {
  const { server, port } = await serve();
  const b = await launch({ width: 390, height: 844 });
  t.after(async () => { await b.close(); server.close(); });

  const url = `http://127.0.0.1:${port}/log/`;
  await b.goto(url);
  await b.run("localStorage.clear(); " + SEED);
  await b.goto(url);
  await b.run(SET("bike", "B") + SET("track", "T"));
  await b.run("document.getElementById('dock-advance').click();");
  await b.run(SET("tire-brand", "P") + SET("tire-model", "M") + SET("front-pre", "30.0"));
  await new Promise((r) => setTimeout(r, 300));
  await b.run("document.getElementById('front-pre-pad').scrollIntoView({block:'center'});");
  await new Promise((r) => setTimeout(r, 200));

  const box = await b.eval(`(function(){var r=document.getElementById('front-pre-pad').getBoundingClientRect();
    return {x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)};})()`);

  await b.touch("touchStart", [{ x: box.x, y: box.y, id: 1 }]);
  for (let i = 1; i <= 8; i += 1) {
    await b.touch("touchMove", [{ x: box.x, y: box.y - i * 10, id: 1 }]);
    await new Promise((r) => setTimeout(r, 12));
  }
  await b.touch("touchEnd", []);
  await new Promise((r) => setTimeout(r, 200));

  assert.equal(await b.eval("document.getElementById('front-pre').value"), "30.0",
    "a vertical gesture leaves the value alone");
});
