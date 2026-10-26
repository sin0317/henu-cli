export async function readPageState(page) {
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    text: await page.locator('body').innerText({ timeout: 10000 }).catch(() => '')
  };
}

// 等页面从“加载中”稳定下来，避免在 SPA 还没渲染时读取 DOM。
export async function settlePage(page, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 8000);
  let previous = '';
  let stableCount = 0;

  while (Date.now() < deadline) {
    const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    if (text.length > 0 && text === previous) {
      stableCount += 1;
      if (stableCount >= 2) {
        return;
      }
    } else {
      stableCount = 0;
    }
    previous = text;
    await page.waitForTimeout(options.intervalMs ?? 400);
  }
}

// 收集 jwapp 教务接口的 JSON 响应，这是解析课表最稳的来源。
export function captureJsonResponses(page, options = {}) {
  const captured = [];
  const matcher = options.match ?? ((url) => url.includes('/jwapp/'));

  page.on('response', (response) => {
    const url = response.url();
    const type = response.headers()['content-type'] ?? '';
    if (!matcher(url) || !type.includes('json')) {
      return;
    }
    response.json()
      .then((body) => captured.push({ url, body }))
      .catch(() => {});
  });

  return captured;
}
