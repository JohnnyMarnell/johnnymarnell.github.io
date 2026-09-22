// Builds the Jekyll site once before the suite so specs assert on the real
// Liquid output — a typo'd include parameter has to surface as a test failure.
const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

module.exports = () => {
  const repo = path.resolve(__dirname, "../..");
  if (process.env.SKIP_BUILD === "1") {
    if (!existsSync(path.join(repo, "_site/led/index.html"))) {
      throw new Error("SKIP_BUILD=1 but _site/led/index.html is missing — run `just build` first.");
    }
    return;
  }
  try {
    execFileSync("bundle", ["exec", "jekyll", "build"], { cwd: repo, stdio: "inherit" });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        "`bundle` not on PATH. Install the Ruby toolchain (`just install`), or build the site\n" +
          "separately and re-run with SKIP_BUILD=1.",
      );
    }
    throw err;
  }
};
