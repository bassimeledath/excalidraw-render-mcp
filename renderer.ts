/**
 * Headless renderer for Excalidraw diagrams (PNG and SVG).
 * Uses agent-browser (Playwright wrapper) to render diagrams in headless Chromium.
 * Singleton pattern: browser is lazily initialized on first call and reused.
 *
 * Navigates to esm.sh and dynamically imports Excalidraw modules via page.evaluate(),
 * since setContent() doesn't properly resolve <script type="module"> imports.
 */

import { BrowserManager } from "agent-browser/dist/browser.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let browser: BrowserManager | null = null;
let pageReady = false;

/**
 * Browser-side initialization script. Runs inside headless Chromium.
 * Sets up DOM, loads Excalidraw from esm.sh, and exposes renderDiagram().
 */
const BROWSER_INIT_SCRIPT = `
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

async function ensureBrowser(): Promise<BrowserManager> {
  if (browser) {
    try {
      const page = browser.getPage();
      await page.evaluate(() => true);
      return browser;
    } catch {
      try { await browser.close(); } catch { /* ignore */ }
      browser = null;
      pageReady = false;
    }
  }

  browser = new BrowserManager();
  await browser.launch({ id: "excalidraw", action: "launch", headless: true });

  const page = browser.getPage();

  // Navigate to esm.sh so relative module imports resolve correctly
  await page.goto("https://esm.sh", { waitUntil: "domcontentloaded" });

  // Initialize Excalidraw in the browser context
  await page.evaluate(BROWSER_INIT_SCRIPT);

  // Verify initialization succeeded
  const ready = await page.evaluate(() => (globalThis as any).__RENDER_READY__ === true);
  if (!ready) {
    throw new Error("Excalidraw initialization failed in headless browser");
  }

  pageReady = true;
  return browser;
}

/**
 * Render elements in headless browser and return the result.
 * Shared by renderToPng and renderToSvg.
 */
async function renderInBrowser(
  elementsJson: string,
  scale: number,
): Promise<{ page: any; svgMarkup: string }> {
  const mgr = await ensureBrowser();
  const page = mgr.getPage();

  const result = await page.evaluate(
    async ({ json, opts }: { json: string; opts: { scale: number } }) => {
      return await (globalThis as any).renderDiagram(json, opts);
    },
    { json: elementsJson, opts: { scale } },
  );

  return { page, svgMarkup: result.svg };
}

/**
 * Ensure the directory for a file path exists.
 */
function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Render Excalidraw elements JSON to a PNG file.
 *
 * @param elementsJson - JSON array string of Excalidraw elements
 * @param outputPath - Optional output file path. If not provided, uses a temp file.
 * @param options - { scale?: number } - Scale factor for retina output (default: 2)
 * @returns Absolute path to the saved PNG file
 */
export async function renderToPng(
  elementsJson: string,
  outputPath?: string,
  options?: { scale?: number },
): Promise<string> {
  const scale = options?.scale ?? 2;
  const { page } = await renderInBrowser(elementsJson, scale);

  const svgLocator = page.locator("#canvas > svg");
  await svgLocator.waitFor({ state: "visible", timeout: 10_000 });

  const dest = outputPath
    ? path.resolve(outputPath)
    : path.join(os.tmpdir(), `excalidraw-${Date.now()}.png`);

  ensureDir(dest);
  await svgLocator.screenshot({ path: dest, type: "png" });

  return dest;
}

/**
 * Render Excalidraw elements JSON to an SVG file.
 *
 * @param elementsJson - JSON array string of Excalidraw elements
 * @param outputPath - Optional output file path. If not provided, uses a temp file.
 * @returns Absolute path to the saved SVG file
 */
export async function renderToSvg(
  elementsJson: string,
  outputPath?: string,
): Promise<string> {
  const { svgMarkup } = await renderInBrowser(elementsJson, 1);

  const dest = outputPath
    ? path.resolve(outputPath)
    : path.join(os.tmpdir(), `excalidraw-${Date.now()}.svg`);

  ensureDir(dest);
  fs.writeFileSync(dest, svgMarkup, "utf-8");

  return dest;
}

/**
 * Close the headless browser. Call on process shutdown.
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
    browser = null;
    pageReady = false;
  }
}
