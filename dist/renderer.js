var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};

// renderer.ts
import { BrowserManager } from "agent-browser/dist/browser.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var browser = null;
var pageReady = false;
var BROWSER_INIT_SCRIPT = `
(async () => {
  document.body.innerHTML = '<div id="canvas" style="display:inline-block"></div>';
  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.background = "white";

  const { convertToExcalidrawElements, exportToSvg } = await import(
    "https://esm.sh/@excalidraw/excalidraw@0.18.0"
  );

  // Virgil font is loaded by Excalidraw internally and inlined by exportToSvg.
  // Wait briefly for Excalidraw's font loader to finish.
  await new Promise(function(r) { setTimeout(r, 1000); });

  const EXPORT_PADDING = 20;

  function computeSceneBounds(elements) {
    let minX = Infinity, minY = Infinity;
    for (const el of elements) {
      if (el.x != null) {
        minX = Math.min(minX, el.x);
        minY = Math.min(minY, el.y);
        if (el.points && Array.isArray(el.points)) {
          for (const pt of el.points) {
            minX = Math.min(minX, el.x + pt[0]);
            minY = Math.min(minY, el.y + pt[1]);
          }
        }
      }
    }
    return {
      minX: isFinite(minX) ? minX : 0,
      minY: isFinite(minY) ? minY : 0,
    };
  }

  function sceneToSvgViewBox(vp, sceneMinX, sceneMinY) {
    return {
      x: vp.x - sceneMinX + EXPORT_PADDING,
      y: vp.y - sceneMinY + EXPORT_PADDING,
      w: vp.width,
      h: vp.height,
    };
  }

  window.renderDiagram = async function(elementsJson, options) {
    options = options || {};
    const scale = options.scale || 2;
    const elements = JSON.parse(elementsJson);

    let viewport = null;
    const drawElements = [];
    for (const el of elements) {
      if (el.type === "cameraUpdate" || el.type === "viewportUpdate") {
        viewport = { x: el.x, y: el.y, width: el.width, height: el.height };
      } else {
        drawElements.push(el);
      }
    }

    if (drawElements.length === 0) throw new Error("No drawable elements provided");

    const withLabelDefaults = drawElements.map(function(el) {
      return el.label ? Object.assign({}, el, { label: Object.assign({ textAlign: "center", verticalAlign: "middle" }, el.label) }) : el;
    });

    const excalidrawEls = convertToExcalidrawElements(withLabelDefaults, { regenerateIds: false })
      .map(function(el) { return el.type === "text" ? Object.assign({}, el, { fontFamily: 1 }) : el; });

    const svg = await exportToSvg({
      elements: excalidrawEls,
      appState: { viewBackgroundColor: "#ffffff", exportBackground: true },
      files: null,
      exportPadding: EXPORT_PADDING,
      skipInliningFonts: false,
    });

    if (viewport) {
      const bounds = computeSceneBounds(drawElements);
      const vb = sceneToSvgViewBox(viewport, bounds.minX, bounds.minY);
      svg.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.w + " " + vb.h);
    }

    const w = viewport ? viewport.width * scale : parseInt(svg.getAttribute("width") || "800");
    const h = viewport ? viewport.height * scale : parseInt(svg.getAttribute("height") || "600");
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.style.width = w + "px";
    svg.style.height = h + "px";

    const svgMarkup = new XMLSerializer().serializeToString(svg);

    const canvas = document.getElementById("canvas");
    canvas.innerHTML = "";
    canvas.appendChild(svg);

    return { width: w, height: h, svg: svgMarkup };
  };

  window.__RENDER_READY__ = true;
})()
`;
async function ensureBrowser() {
  if (browser) {
    try {
      const page2 = browser.getPage();
      await page2.evaluate(() => true);
      return browser;
    } catch {
      try {
        await browser.close();
      } catch {}
      browser = null;
      pageReady = false;
    }
  }
  browser = new BrowserManager;
  await browser.launch({ id: "excalidraw", action: "launch", headless: true });
  const page = browser.getPage();
  await page.goto("https://esm.sh", { waitUntil: "domcontentloaded" });
  await page.evaluate(BROWSER_INIT_SCRIPT);
  const ready = await page.evaluate(() => globalThis.__RENDER_READY__ === true);
  if (!ready) {
    throw new Error("Excalidraw initialization failed in headless browser");
  }
  pageReady = true;
  return browser;
}
async function renderInBrowser(elementsJson, scale) {
  const mgr = await ensureBrowser();
  const page = mgr.getPage();
  const result = await page.evaluate(async ({ json, opts }) => {
    return await globalThis.renderDiagram(json, opts);
  }, { json: elementsJson, opts: { scale } });
  return { page, svgMarkup: result.svg };
}
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
async function renderToPng(elementsJson, outputPath, options) {
  const scale = options?.scale ?? 2;
  const { page } = await renderInBrowser(elementsJson, scale);
  const svgLocator = page.locator("#canvas > svg");
  await svgLocator.waitFor({ state: "visible", timeout: 1e4 });
  const dest = outputPath ? path.resolve(outputPath) : path.join(os.tmpdir(), `excalidraw-${Date.now()}.png`);
  ensureDir(dest);
  await svgLocator.screenshot({ path: dest, type: "png" });
  return dest;
}
async function renderToSvg(elementsJson, outputPath) {
  const { svgMarkup } = await renderInBrowser(elementsJson, 1);
  const dest = outputPath ? path.resolve(outputPath) : path.join(os.tmpdir(), `excalidraw-${Date.now()}.svg`);
  ensureDir(dest);
  fs.writeFileSync(dest, svgMarkup, "utf-8");
  return dest;
}
async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch {}
    browser = null;
    pageReady = false;
  }
}
export {
  renderToSvg,
  renderToPng,
  closeBrowser
};
