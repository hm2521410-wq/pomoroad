// テスト用の小さな ntfy の代わり（送る・受け取るの最低限だけ）
import http from 'node:http';

export function startNtfyMock() {
  const topics = new Map(); // topic -> messages[]
  const subs = new Set(); // { topic, res }
  let seq = 0;
  const publish = (topic, fields) => {
    const msg = { id: `m${++seq}`, time: Math.floor(Date.now() / 1000), event: 'message', topic, ...fields };
    if (!topics.has(topic)) topics.set(topic, []);
    topics.get(topic).push(msg);
    for (const s of subs) if (s.topic === topic) s.res.write(`${JSON.stringify(msg)}\n`);
    return msg;
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.method === 'POST' && parts.length === 0) {
        const o = JSON.parse(body);
        res.end(JSON.stringify(publish(o.topic, { message: o.message, title: o.title, priority: o.priority, tags: o.tags })));
      } else if (parts.length === 2 && ['publish', 'send', 'trigger'].includes(parts[1])) {
        res.end(JSON.stringify(publish(parts[0], { message: url.searchParams.get('message') ?? 'triggered' })));
      } else if (req.method === 'POST' && parts.length === 1) {
        res.end(JSON.stringify(publish(parts[0], { message: body })));
      } else if (req.method === 'GET' && parts.length === 2 && parts[1] === 'json') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write(`${JSON.stringify({ id: 'open', event: 'open', topic: parts[0], time: Math.floor(Date.now() / 1000) })}\n`);
        const since = url.searchParams.get('since');
        if (since) {
          const list = topics.get(parts[0]) ?? [];
          const i = list.findIndex((m) => m.id === since);
          for (const m of list.slice(i + 1)) res.write(`${JSON.stringify(m)}\n`);
        }
        const sub = { topic: parts[0], res };
        subs.add(sub);
        res.on('close', () => subs.delete(sub));
      } else {
        res.statusCode = 404;
        res.end('not found');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({
        url,
        topics,
        publish,
        subscribers: (topic) => [...subs].filter((s) => s.topic === topic).length,
        dropAll: () => {
          for (const s of subs) s.res.destroy();
          subs.clear();
        },
        close: () =>
          new Promise((r) => {
            for (const s of subs) s.res.destroy();
            server.close(r);
          }),
      });
    });
  });
}
