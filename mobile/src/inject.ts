// What the phone app puts into the page. Plain JavaScript strings, run inside the WebView.

import type { NativeToWeb } from "./protocol";

/**
 * Runs before the page's own code, on every page load:
 * - says this is the phone app (lib/platform.ts isPhoneApp looks for __cheerPressureNative);
 * - a receiver that queues native -> web messages until lib/phone.ts takes over, so nothing sent
 *   at start is lost;
 * - no zooming (pinch or double tap), the page is laid out for the phone;
 * - keeps track of the page's sounds (audio and video elements, Web Audio), so the app can stop
 *   them when it goes to the background and pick them up again when it comes back;
 * - tells the app the page's background colour, for the status bar and the edges.
 */
export function beforeContentScript(info: { version: number; platform: string; build: string }): string {
  return `(function () {
  if (window.__cheerPressureNative) return;
  window.__cheerPressureNative = ${JSON.stringify(info)};
  if (!window.__cheerPressurePhone) {
    var q = [];
    window.__cheerPressurePhone = { queue: q, receive: function (m) { q.push(m); } };
  }

  function post(m) {
    try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {}
  }

  // No zoom.
  var VIEWPORT = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
  function viewport() {
    var head = document.head || document.documentElement;
    if (!head) return;
    var metas = document.querySelectorAll('meta[name="viewport"]');
    if (!metas.length) {
      var m = document.createElement("meta");
      m.name = "viewport";
      head.appendChild(m);
      metas = [m];
    }
    for (var i = 0; i < metas.length; i++) if (metas[i].getAttribute("content") !== VIEWPORT) metas[i].setAttribute("content", VIEWPORT);
  }
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); }, { passive: false });

  // Sound: what is playing, so it can be stopped in the background.
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
  var media = new Set();
  var contexts = [];
  var origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { media.add(this); return origPlay.apply(this, arguments); };
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) {
    var Tracked = function (o) { var c = o === undefined ? new Ctx() : new Ctx(o); contexts.push(c); return c; };
    Tracked.prototype = Ctx.prototype;
    window.AudioContext = Tracked;
    if (window.webkitAudioContext) window.webkitAudioContext = Tracked;
  }
  var stopped = { media: [], contexts: [] };
  window.__cheerPressureShell = {
    background: function () {
      media.forEach(function (el) { if (!el.paused && !el.ended) { el.pause(); stopped.media.push(el); } });
      contexts.forEach(function (c) { if (c.state === "running") { c.suspend(); stopped.contexts.push(c); } });
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    },
    foreground: function () {
      stopped.media.forEach(function (el) { var p = el.play(); if (p && p.catch) p.catch(function () {}); });
      stopped.contexts.forEach(function (c) { if (c.state === "suspended") c.resume(); });
      stopped = { media: [], contexts: [] };
      look();
    }
  };

  // The page's colour, for the status bar.
  var lastLook = "";
  function look() {
    var el = document.body || document.documentElement;
    if (!el) return;
    var bg = getComputedStyle(el).backgroundColor;
    if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") bg = getComputedStyle(document.documentElement).backgroundColor;
    var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var key = bg + "|" + dark;
    if (key === lastLook) return;
    lastLook = key;
    post({ cheerPressureShell: "look", background: bg, scheme: dark ? "dark" : "light", path: location.pathname });
  }
  function settle() { viewport(); look(); }
  ["pushState", "replaceState"].forEach(function (k) {
    var orig = history[k];
    history[k] = function () { var r = orig.apply(this, arguments); setTimeout(settle, 50); return r; };
  });
  window.addEventListener("popstate", function () { setTimeout(settle, 50); });
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", look);
  document.addEventListener("DOMContentLoaded", function () {
    settle();
    new MutationObserver(viewport).observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["content"] });
  });
  window.addEventListener("load", settle);
})();
true;`;
}

/** Hands one message to the page's receiver (or its queue, until lib/phone.ts has loaded). */
export function deliverScript(msg: NativeToWeb): string {
  return `(function(){var p=window.__cheerPressurePhone;if(p&&p.receive)p.receive(${JSON.stringify(msg)});})();true;`;
}

export const BACKGROUND_SCRIPT = `window.__cheerPressureShell&&window.__cheerPressureShell.background();true;`;
export const FOREGROUND_SCRIPT = `window.__cheerPressureShell&&window.__cheerPressureShell.foreground();true;`;

/** Opens a screen with a full page load (the export's pages are real folders, so this always works). */
export function openPathScript(path: string): string {
  return `location.assign(${JSON.stringify(path)});true;`;
}
