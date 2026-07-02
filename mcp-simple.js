#!/usr/bin/env node
// 最简 MCP Server - 仅用于测试连接
process.stderr.write('Simple MCP starting...\n');

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  process.stderr.write('Got data: ' + chunk.length + ' bytes\n');
  buffer += chunk;
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = buffer.substring(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { buffer = buffer.substring(headerEnd + 4); continue; }
    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + contentLength) break;
    const body = buffer.substring(bodyStart, bodyStart + contentLength);
    buffer = buffer.substring(bodyStart + contentLength);

    try {
      const msg = JSON.parse(body);
      process.stderr.write('Method: ' + msg.method + '\n');

      if (msg.method === 'initialize') {
        const resp = JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'tabbit-simple', version: '1.0.0' }
          }
        });
        process.stdout.write('Content-Length: ' + Buffer.byteLength(resp) + '\r\n\r\n' + resp);
        process.stderr.write('Sent initialize response\n');
      } else if (msg.method === 'tools/list') {
        const resp = JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { tools: [] }
        });
        process.stdout.write('Content-Length: ' + Buffer.byteLength(resp) + '\r\n\r\n' + resp);
        process.stderr.write('Sent tools/list response\n');
      } else if (msg.method === 'ping') {
        const resp = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} });
        process.stdout.write('Content-Length: ' + Buffer.byteLength(resp) + '\r\n\r\n' + resp);
      }
    } catch (e) {
      process.stderr.write('Error: ' + e.message + '\n');
    }
  }
});

process.stdin.on('end', () => {
  process.stderr.write('stdin ended\n');
  process.exit(0);
});

process.stderr.write('Simple MCP ready, waiting for input...\n');
