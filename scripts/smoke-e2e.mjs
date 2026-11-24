import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const DIST_DIR = join(ROOT, "dist");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function parseHeadersFile(filePath) {
  const rules = [];
  if (!existsSync(filePath)) return rules;
  let current = null;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    if (!rawLine.startsWith(" ") && !rawLine.startsWith("\t")) {
      current = { pattern: rawLine.trim(), headers: [] };
      rules.push(current);
    } else if (current) {
      const idx = rawLine.indexOf(":");
      if (idx > 0) {
        current.headers.push([rawLine.slice(0, idx).trim(), rawLine.slice(idx + 1).trim()]);
      }
    }
  }
  return rules;
}

function matchPattern(pattern, pathname) {
  if (pattern === "/*") return true;
  if (pattern.endsWith("/*")) {
    return pathname.startsWith(pattern.slice(0, -1));
  }
  return pathname === pattern;
}

function startStaticServer(distDir) {
  const headerRules = parseHeadersFile(join(distDir, "_headers"));
  return new Promise((resolveServer) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(reqUrl.pathname);
      if (pathname === "/") pathname = "/index.html";

      const fullPath = resolve(distDir, "." + pathname);
      if (!fullPath.startsWith(distDir) || !existsSync(fullPath) || statSync(fullPath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const headers = {
        "Content-Type": MIME_TYPES[extname(fullPath)] ?? "application/octet-stream",
      };
      for (const rule of headerRules) {
        if (matchPattern(rule.pattern, pathname)) {
          for (const [k, v] of rule.headers) {
            headers[k] = v;
          }
        }
      }
      res.writeHead(200, headers);
      res.end(readFileSync(fullPath));
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolveServer({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    "playwright",
    "/home/rinzler/.local/share/mise/installs/playwright/latest/node_modules/playwright",
  ].filter(Boolean);

  for (const id of candidates) {
    try {
      return require(id);
    } catch {
      // Try next candidate
    }
  }
  throw new Error(
    "Playwright not found. Install playwright or set PLAYWRIGHT_PATH to run E2E smoke tests.",
  );
}

function findChromiumExecutable() {
  for (const bin of [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"]) {
    if (bin && existsSync(bin)) return bin;
  }
  return undefined;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function run() {
  if (!existsSync(join(DIST_DIR, "index.html"))) {
    throw new Error("dist/index.html missing. Run `npm run build` first.");
  }

  const { chromium } = loadPlaywright();
  const { server, url } = await startStaticServer(DIST_DIR);
  const executablePath = findChromiumExecutable();

  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

    const consoleErrors = [];
    const pageErrors = [];
    const cspViolations = [];
    const externalRequests = [];

    try {
      const context = await browser.newContext({
        viewport: { width: 1024, height: 768 },
        permissions: ["camera", "clipboard-read", "clipboard-write"],
      });
      const page = await context.newPage();

      await page.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener("securitypolicyviolation", (e) => {
          window.__cspViolations.push(`${e.effectiveDirective}: ${e.blockedURI}`);
        });
      });

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = msg.text();
          // Emscripten writes TFLite's C++ stderr INFO banner to console.error
          if (text.startsWith("INFO: Created TensorFlow Lite")) return;
          consoleErrors.push(text);
        }
      });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("request", (req) => {
      const reqUrl = req.url();
      if (!reqUrl.startsWith(url) && !reqUrl.startsWith("data:") && !reqUrl.startsWith("blob:")) {
        externalRequests.push(reqUrl);
      }
    });

    // 1. Verify OG image asset and CORP header
    const ogRes = await page.request.get(`${url}/og-card.png`);
    assert(ogRes.status() === 200, `Expected /og-card.png 200, got ${ogRes.status()}`);
    assert(ogRes.headers()["content-type"] === "image/png", "Expected image/png for /og-card.png");
    assert(
      ogRes.headers()["cross-origin-resource-policy"] === "cross-origin",
      "Expected CORP cross-origin on /og-card.png",
    );

    // 2. Load home page with friend challenge query param (?day=1&vs=73)
    await page.goto(`${url}/?day=1&vs=73`, { waitUntil: "networkidle" });
    const bannerText = await page.locator("#challenge-banner").textContent();
    assert(bannerText?.includes("73% human"), `Expected colleague banner, got: ${bannerText}`);

    // 3. Test Case File modal dialog open, content, and backdrop light-dismiss
    await page.click("#open-case-file");
    await page.waitForSelector("#case-file-dialog[open]");
    const folderCount = await page.locator("#case-folder-grid > li").count();
    assert(folderCount === 10, `Expected 10 case file folders, got ${folderCount}`);
    await page.mouse.click(8, 8); // Click outside dialog backdrop
    await page.waitForFunction(() => !document.getElementById("case-file-dialog")?.hasAttribute("open"));

    // 4. Test mute toggle
    const initialPressed = await page.getAttribute("#mute-toggle", "aria-pressed");
    await page.click("#mute-toggle");
    const nextPressed = await page.getAttribute("#mute-toggle", "aria-pressed");
    assert(initialPressed !== nextPressed, "Mute toggle aria-pressed did not change");

    // 5. Launch real camera + MediaPipe FaceLandmarker under enforced CSP
    await page.click("#verify-human");
    await page.waitForFunction(
      () => !document.getElementById("panel-stage")?.hasAttribute("hidden"),
      null,
      { timeout: 15_000 },
    );

    // Let live rAF + FaceTracker.detectForVideo run for a moment under CSP
    await page.waitForTimeout(800);
    const stageHidden = await page.getAttribute("#panel-stage", "hidden");
    assert(stageHidden === null, "Expected #panel-stage to remain visible during calibration");

    // Abort inspection and verify clean return to intro
    await page.click("#abort-round");
    await page.waitForFunction(() => !document.getElementById("panel-intro")?.hasAttribute("hidden"));
    cspViolations.push(...(await page.evaluate(() => window.__cspViolations ?? [])));

    // 6. Test returning finished daily player verdict view, countdown timer, and copy button
    const todayDay = Math.max(
      1,
      Math.floor(
        (Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) -
          Date.UTC(2026, 10, 18)) /
          86_400_000,
      ) + 1,
    );
    await page.evaluate((day) => {
      localStorage.setItem(
        "fleshcheck:v1",
        JSON.stringify({
          streak: 3,
          lastDay: day,
          today: { day, tries: [{ passed: true, pct: 100, paused: false }] },
          departments: { POKER_FACE: { tries: 1, passes: 1, bestPct: 100 } },
        }),
      );
    }, todayDay);

    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => !document.getElementById("panel-verdict")?.hasAttribute("hidden"));

    const countdownText = await page.locator("#next-case-text").textContent();
    assert(
      /Next case opens in \d{2}:\d{2}:\d{2} UTC\./.test(countdownText ?? ""),
      `Expected UTC countdown on finished daily verdict, got: ${countdownText}`,
    );
    const retryDisplay = await page.evaluate(() => {
      const btn = document.getElementById("retry-try");
      return btn ? window.getComputedStyle(btn).display : null;
    });
    assert(retryDisplay === "none", `Expected #retry-try to be hidden on finished verdict, got display=${retryDisplay}`);

    await page.click("#copy-share-btn");
    await page.waitForFunction(() =>
      document.getElementById("copy-share-btn")?.hasAttribute("data-copied"),
    );

    const detectedCsp = await page.evaluate(() => window.__cspViolations ?? []);
    cspViolations.push(...detectedCsp);

    assert(cspViolations.length === 0, `CSP violations detected: ${cspViolations.join(" | ")}`);
    assert(externalRequests.length === 0, `Unexpected external network requests: ${externalRequests.join(", ")}`);
    assert(pageErrors.length === 0, `Uncaught page errors: ${pageErrors.join(" | ")}`);
    assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(" | ")}`);

    console.log("E2E smoke passed: CSP clean, zero external requests, MediaPipe WASM + camera + dialog + verdict + countdown verified.");
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
