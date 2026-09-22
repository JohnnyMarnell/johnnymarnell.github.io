// Minimal static server for the built Jekyll site. No deps so `npm test` works
// without pulling a server package in.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../../_site/", import.meta.url).pathname;
const REPO = new URL("../../", import.meta.url).pathname;
const PORT = Number(process.env.PORT || 4321);

/*
 * The build happens here, before the socket is open, rather than in a
 * Playwright `globalSetup`. Playwright starts `webServer` as a plugin, and
 * plugins run *before* globalSetup — so a globalSetup build races the server's
 * readiness probe and, on a clean checkout with no _site yet, loses: the probe
 * 404s for its whole timeout and the run dies with "Timed out waiting from
 * config.webServer" instead of anything to do with the site.
 *
 * SKIP_BUILD=1 serves whatever is in _site already (`just test-fast`).
 */
if (process.env.SKIP_BUILD === "1") {
  if (!existsSync(join(ROOT, "led/index.html"))) {
    console.error("SKIP_BUILD=1 but _site/led/index.html is missing — run `just build` first.");
    process.exit(1);
  }
} else {
  try {
    execFileSync("bundle", ["exec", "jekyll", "build"], { cwd: REPO, stdio: "inherit" });
  } catch (err) {
    console.error(
      err.code === "ENOENT"
        ? "`bundle` is not on PATH. Run `just install`, or build separately and use `just test-fast`."
        : `jekyll build failed: ${err.message}`,
    );
    process.exit(1);
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // normalize() then strip leading separators: keeps `..` from escaping ROOT.
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    let file = join(ROOT, rel);
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`serving _site on http://127.0.0.1:${PORT}`));
