// 把 promo/ 下的 HTML 渲染成固定尺寸 PNG。
// 用法（必须在 henu-cli 目录下跑，才能解析到 playwright）：
//   node scripts/render-cover.mjs ../promo/cover.html ../promo/cover.png
// 可选：第 3、4 个参数指定宽高（默认 1080x1440，即小红书 3:4），第 5 个参数为缩放倍数（默认 2）
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [, , htmlArg, outArg, wArg = '1080', hArg = '1440', scaleArg = '2'] = process.argv;
if (!htmlArg || !outArg) {
  console.error('用法: node scripts/render-cover.mjs <html> <out.png> [width=1080] [height=1440] [scale=2]');
  process.exit(2);
}

const width = Number(wArg);
const height = Number(hArg);
const scale = Number(scaleArg);
const htmlPath = resolve(htmlArg);
const outPath = resolve(outArg);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });

await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

const box = await page.evaluate(() => ({
  h: document.documentElement.scrollHeight,
  w: document.documentElement.scrollWidth
}));
if (box.h > height) console.warn(`!! 内容高度 ${box.h} 超过画布 ${height}，底部会被裁掉`);
if (box.w > width) console.warn(`!! 内容宽度 ${box.w} 超过画布 ${width}，右侧会被裁掉`);

await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width, height } });
await browser.close();
console.log(`saved ${outPath} (${width}x${height} @${scale}x → ${width * scale}x${height * scale})`);
