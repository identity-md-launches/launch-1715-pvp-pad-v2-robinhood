import { writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const requireBrowser = createRequire(
  resolve(process.env.PVP_BROWSER_TOOLS || "/tmp/pvp-browser", "package.json"),
);
const { chromium } = requireBrowser("playwright");
const font = await readFile(
  new URL("../fonts/geist-latin-wght-normal.woff2", import.meta.url),
);
const tiles = Array.from({ length: 51 }, (_, i) => {
  const h = 25 - i,
    w = 24 + (1 - Math.abs(h) / 25) * 320,
    y = 65 + i * 10;
  return `<rect x="${955 - w / 2}" y="${y}" width="${w}" height="6" fill="${h === 0 ? "#71717a" : i % 5 === 0 ? "#3f3f46" : "#27272a"}"/><path d="M${955 - w / 2} ${y}h${w}" stroke="${h > 0 ? "#34d399" : "#f87171"}" stroke-opacity=".5"/>`;
}).join("");
const imp = (x, y, color) =>
  `<g fill="${color}" transform="translate(${x} ${y}) scale(4)"><path d="M0 0h1v2h1V1h1v1h2V1h1v1h1V0h1v4H7v3H6v2H5V8H3v1H2V7H1V4H0Z"/><path d="M2 3h1v1H2zm3 0h1v1H5z" fill="#09090b"/></g>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#09090b"/><rect x="738" y="25" width="437" height="580" rx="24" fill="#18181b"/><g font-family="Geist, sans-serif" fill="#fafafa"><path d="m88 45 20 27-20 27-20-27Z" fill="none" stroke="#fbbf24" stroke-width="2"/><path d="m88 45 7 31-7 23-7-23Zm-20 27 20 4 20-4" fill="none" stroke="#fbbf24"/><text x="125" y="85" font-size="34" font-weight="600">PvP Pad</text><text x="64" y="264" font-size="68" font-weight="700" letter-spacing="-3">A coin. A game.</text><text x="64" y="346" font-size="68" font-weight="700" letter-spacing="-3">A race to either bell<tspan fill="#fbbf24">.</tspan></text><text x="66" y="411" font-size="24" fill="#a1a1aa">50-minute Imp games on Robinhood Chain.</text><rect x="64" y="466" width="284" height="60" rx="10" fill="#fbbf24"/><text x="88" y="505" font-size="23" fill="#09090b" font-weight="600">Enter. Roll. Reveal.</text><text x="64" y="582" font-size="16" fill="#a1a1aa">Experimental, unaudited contracts. All funds are at risk.</text></g>${tiles}<g fill="#fbbf24"><path d="M951 29h8v5h6v15h6v5h-32v-5h6V34h6zm0 28h8v5h-8Z"/><path d="M951 574h8v5h6v15h6v5h-32v-5h6v-15h6zm0 28h8v5h-8Z"/></g>${imp(932, 184, "#34d399")}${imp(884, 284, "#a78bfa")}${imp(982, 364, "#f87171")}</svg>`;
// Text and geometric pixel art are original. Font data is only injected during rasterization.
await writeFile(new URL("../assets/social.svg", import.meta.url), svg);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: "/tmp/pvp-xdg-config",
    XDG_CACHE_HOME: "/tmp/pvp-xdg-cache",
  },
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font.toString("base64")})}body{margin:0}svg{display:block}</style>${svg}`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: new URL("../assets/social.png", import.meta.url).pathname,
  });
} finally {
  await browser.close();
}
console.log("Original social card rendered to site/assets/social.png");
