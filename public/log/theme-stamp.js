// Runs before first paint, from <head>, so the page never flashes the wrong
// theme. It has to be a file rather than an inline script because the page
// sets script-src 'self'.
//
// mt.theme.mode is "auto" | "bright" | "dark", shared with Pro. "auto" follows
// the phone and keeps following it, so a rider who changes their phone at dusk
// does not have to come back here.
(function () {
  var KEY = "mt.theme.mode";
  var root = document.documentElement;

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "bright" || v === "dark" || v === "auto" ? v : "auto";
    } catch (e) {
      // Private mode, or storage blocked entirely. Auto is the honest default:
      // it asks the device rather than guessing.
      return "auto";
    }
  }

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function apply(mode) {
    var dark = mode === "dark" || (mode === "auto" && systemPrefersDark());
    if (dark) root.setAttribute("data-mt", "dark");
    else root.removeAttribute("data-mt");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#05070B" : "#EEF1F5");
    return dark;
  }

  apply(stored());

  // Exposed so the About control can re-apply without duplicating the rules.
  window.MotoTrackTheme = {
    KEY: KEY,
    get: stored,
    apply: apply,
    set: function (mode) {
      try { localStorage.setItem(KEY, mode); } catch (e) { /* still applies for this view */ }
      return apply(mode);
    },
  };

  // Only matters in auto, and only while the rider stays on the page.
  if (window.matchMedia) {
    var q = window.matchMedia("(prefers-color-scheme: dark)");
    var onChange = function () { if (stored() === "auto") apply("auto"); };
    if (q.addEventListener) q.addEventListener("change", onChange);
    else if (q.addListener) q.addListener(onChange);
  }
})();
