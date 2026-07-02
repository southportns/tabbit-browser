const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:9222/devtools/page/673ABD66E200EDE9537D1DBFA4CA1176");
let id = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

ws.on("open", async () => {
  // 等一下让页面稳定
  await new Promise((r) => setTimeout(r, 500));

  const expr = `(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = [];
    document.querySelectorAll('*').forEach(e => {
      if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0) {
        offenders.push({
          tag: e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').slice(0,3).join('.') : ''),
          client: e.clientWidth,
          scroll: e.scrollWidth,
          ovf: getComputedStyle(e).overflowX,
          minWidth: getComputedStyle(e).minWidth
        });
      }
    });
    offenders.sort((a,b)=>(b.scroll-b.client)-(a.scroll-a.client));
    return JSON.stringify({
      vw,
      bodyClient: document.body.clientWidth,
      bodyScroll: document.body.scrollWidth,
      htmlScroll: document.documentElement.scrollWidth,
      top10: offenders.slice(0,10)
    }, null, 2);
  })()`;

  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  console.log(r.result.value);
  ws.close();
  process.exit(0);
});

ws.on("error", (e) => { console.error("WS error:", e.message); process.exit(1); });
