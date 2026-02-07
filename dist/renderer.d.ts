/**
 * Headless renderer for Excalidraw diagrams (PNG and SVG).
 * Uses agent-browser (Playwright wrapper) to render diagrams in headless Chromium.
 * Singleton pattern: browser is lazily initialized on first call and reused.
 *
 * Navigates to esm.sh and dynamically imports Excalidraw modules via page.evaluate(),
 * since setContent() doesn't properly resolve <script type="module"> imports.
 */
/**
 * Render Excalidraw elements JSON to a PNG file.
 *
 * @param elementsJson - JSON array string of Excalidraw elements
 * @param outputPath - Optional output file path. If not provided, uses a temp file.
 * @param options - { scale?: number } - Scale factor for retina output (default: 2)
 * @returns Absolute path to the saved PNG file
 */
export declare function renderToPng(elementsJson: string, outputPath?: string, options?: {
    scale?: number;
}): Promise<string>;
/**
 * Render Excalidraw elements JSON to an SVG file.
 *
 * @param elementsJson - JSON array string of Excalidraw elements
 * @param outputPath - Optional output file path. If not provided, uses a temp file.
 * @returns Absolute path to the saved SVG file
 */
export declare function renderToSvg(elementsJson: string, outputPath?: string): Promise<string>;
/**
 * Close the headless browser. Call on process shutdown.
 */
export declare function closeBrowser(): Promise<void>;
