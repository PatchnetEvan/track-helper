// Opt-in: real layout, in a real browser. The stub DOM has no layout engine,
// so the one thing that actually matters here - whether the rider can see the
// REAR row and the dock at the same time - cannot be tested anywhere else.
//
// 390x701 is the usable height of a browser tab on a 390x844 phone, not the
// screen height. Run with BROWSER_TESTS=1.
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
  setup:{bike:'#405 Yamaha R3', track:'Homestead'},
  tires:{brand:'Pirelli', model:'Supercorsa SC1', frontPre:'31.0', rearPre:'28.0'},
  suspension:{}, laps:{}, riderFeedback:{}}]));`;

const SET = (id, v) => `var e=document.getElementById('${id}');e.value=${JSON.stringify(v)};` +
  `e.dispatchEvent(new Event('input',{bubbles:true}));`;

async function measurePre(theme) {
  const { server, port } = await serve();
  // 701 of usable height is what a 390x844 phone leaves inside a browser tab.
  const b = await launch({ width: 390, height: 701 });
  try {
    const url = `http://127.0.0.1:${port}/log/`;
    await b.goto(url);
    await b.run(`localStorage.clear(); ${SEED} localStorage.setItem('mt.theme.mode', ${JSON.stringify(theme)});`);
    await b.goto(url);
    await b.run(SET("bike", "#405 Yamaha R3") + SET("track", "Homestead") + SET("session-label", "Session 3"));
    await b.run("document.getElementById('dock-advance').click();");
    await b.run(SET("rear-pre", "48.0"));
    await new Promise((r) => setTimeout(r, 400));
    await b.run("window.scrollTo(0,0);");
    await new Promise((r) => setTimeout(r, 200));
    return await b.eval(`(function(){
      var rowR = document.querySelector('#rear-pre-row').getBoundingClientRect();
      var dock = document.getElementById('dock').getBoundingClientRect();
      var open = document.querySelector('.tire-card--open');
      var panel = open ? open.querySelector('.tire-panel').getBoundingClientRect() : null;
      var needs = Math.max(rowR.bottom, panel ? panel.bottom : 0);
      return { viewport: window.innerHeight,
               needs: Math.round(needs), dockTop: Math.round(dock.top),
               openTire: open ? open.getAttribute('data-tire') : null,
               dark: document.documentElement.getAttribute('data-mt') === 'dark' };
    })()`);
  } finally { await b.close(); server.close(); }
}

for (const theme of ["bright", "dark"]) {
  test(`PRE fits above the dock at 390x701 with FRONT open, in ${theme}`,
    { skip: !ENABLED }, async () => {
    const m = await measurePre(theme);
    assert.equal(m.viewport, 701, "the viewport is the usable height, not the screen");
    assert.equal(m.dark, theme === "dark", `the ${theme} theme is the one being measured`);
    assert.equal(m.openTire, "front-pre", "FRONT is the tire still to be measured, so it opens");
    assert.ok(m.needs <= m.dockTop,
      `PRE needs ${m.needs}px but the dock starts at ${m.dockTop}px - ` +
      `the REAR row or the open controls sit under the dock (${m.needs - m.dockTop}px over)`);
  });
}
