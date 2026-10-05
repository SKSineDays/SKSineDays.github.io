// Local-only HTML renders. Every request is intercepted; no production APIs,
// subscriber data, email sends, link clicks, or remote asset requests occur.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputIndex = process.argv.indexOf("--output");
const OUTPUT = resolve(outputIndex < 0 ? "/tmp/sineday-daily-copy-preview" : process.argv[outputIndex + 1]);
const directoryIndex = process.argv.indexOf("--directory");
const snapshot = directoryIndex < 0 ? "20261004" : process.argv[directoryIndex + 1];
assert.match(snapshot ?? "", /^\d{8}$/, "--directory requires an eight-digit snapshot date");
const DIRECTORY = `docs/email-templates/${snapshot}`;
await mkdir(OUTPUT, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.MAILER_BROWSER_EXECUTABLE ? { executablePath: process.env.MAILER_BROWSER_EXECUTABLE } : {}),
  headless: true,
  args: ["--no-sandbox"]
});
const checks = [];
try {
  for (const width of [320, 375, 520]) {
    for (const colorScheme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme, deviceScaleFactor: 1 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname.slice(1);
        if (url.hostname === "mailer.test" && new RegExp(`^${DIRECTORY}/day-\\d{2}\\.html$`).test(path)) {
          return route.fulfill({ contentType: "text/html", body: await readFile(join(ROOT, path)) });
        }
        if (url.hostname === "sineday.app" && /^assets\/email\/(?:20260924\/scenes\/SineDayScene\d{1,2}|20260911\/wave-\d{2})\.png$/.test(path)) {
          return route.fulfill({ contentType: "image/png", body: await readFile(join(ROOT, path)) });
        }
        return route.abort("blockedbyclient");
      });
      for (let day = 1; day <= 18; day += 1) {
        const stem = `day-${String(day).padStart(2, "0")}`;
        await page.goto(`http://mailer.test/${DIRECTORY}/${stem}.html`, { waitUntil: "load" });
        const result = await page.evaluate(() => {
          const blog = document.querySelector('[data-sineday-surface="blog"]');
          const reflection = document.querySelector('[data-sineday-surface="reflection"]');
          const link = blog.querySelector("a");
          const rect = link.getBoundingClientRect();
          return {
            scrollWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            blog: blog.innerText,
            reflection: reflection.innerText,
            blogLink: link.getAttribute("href"),
            blogTapHeight: rect.height,
            blogRight: rect.right,
            imageCount: document.images.length,
            imagesLoaded: [...document.images].every((image) => image.complete && image.naturalWidth > 0),
            background: getComputedStyle(document.body).backgroundColor,
            title: document.title
          };
        });
        assert.equal(result.scrollWidth, width, `${stem} at ${width}px overflows`);
        assert.equal(result.blogLink, "https://www.sineday.blog/");
        assert.ok(result.blogTapHeight >= 44);
        assert.ok(result.blogRight <= width);
        assert.equal(result.imageCount, 2);
        assert.ok(result.imagesLoaded);
        assert.equal(result.background, "rgb(5, 6, 10)");
        assert.deepEqual(errors, []);
        checks.push({ day, width, colorScheme, ...result });
        if (colorScheme === "light" && ((width === 375 && [1, 9, 18].includes(day)) || (width === 520 && day === 1))) {
          await page.screenshot({ path: join(OUTPUT, `${stem}-${width}px.png`), fullPage: true });
        }
      }
      await page.close();
    }
  }
  const page = await browser.newPage({ viewport: { width: 375, height: 900 } });
  await page.route("**/*", (route) => route.abort("blockedbyclient"));
  for (let day = 1; day <= 18; day += 1) {
    const stem = `day-${String(day).padStart(2, "0")}`;
    await page.setContent(await readFile(join(ROOT, DIRECTORY, `${stem}.html`), "utf8"));
    assert.ok(await page.getByRole("link", { name: "Explore the SineDay blog", exact: true }).isVisible());
    assert.ok(await page.getByRole("link", { name: "mysine@sineday.app", exact: true }).isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
    if (day === 1) await page.screenshot({ path: join(OUTPUT, "day-01-images-blocked.png"), fullPage: true });
  }
  const report = {
    scope: "Local Chromium HTML rendering, not native inbox-client certification",
    network: "Every request intercepted; official checked-in image bytes used locally",
    renderedChecks: checks.length,
    imageBlockedChecks: 18,
    checks
  };
  await writeFile(join(OUTPUT, "render-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Passed ${checks.length} renders plus 18 image-blocked checks. Previews: ${OUTPUT}`);
} finally {
  await browser.close();
}
