/** Static-only local preview. Production API handlers are never executed or served. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const port = Number(value('--port', '4173'));
const host = value('--host', '127.0.0.1');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.avif': 'image/avif',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.pdf': 'application/pdf'
};

createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://preview.invalid').pathname);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(root + sep) || /(?:^|\/)(?:\.[^/]+|api|node_modules)(?:\/|$)/.test(pathname)) {
      response.writeHead(404).end();
      return;
    }
    const info = await stat(path);
    if (!info.isFile() || !types[extname(path)]) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': types[extname(path)], 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, host);
