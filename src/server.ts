import http from 'http';
import path from 'path';
import fs from 'fs/promises';
import {URL} from 'url';
import chokidar from 'chokidar';
import {buildModule} from './viteBuilder.js';
import {scaffoldModule} from './scaffolder.js';

const PORT = 4000;
let clients: http.ServerResponse[] = [];
const sendReloadEvent = () => {
	clients.forEach(client => client.write('data: reload\n\n'));
};


const server = http.createServer(async (request, response) => {
	const {method, url} = request;
	const requestUrl = new URL(url || '/', `http://${request.headers.host}`);
	const {pathname, searchParams} = requestUrl;
	console.log(`Got ${method} request for ${pathname}`);

	try {
		// --- PING ROUTE ---
		if (pathname === '/ping') {
			if (method !== 'GET') throw new Error(`Method ${method} not allowed for /ping.`);
			response.writeHead(200, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: true, message: 'pong'}));

			// --- LIVE RELOAD EVENT STREAM ---
		} else if (pathname === '/events') {
			if (method !== 'GET') throw new Error(`Method ${method} not allowed for /events.`);
			response.writeHead(200, {
				'Content-Type': 'text/event-stream',
				Connection: 'keep-alive',
				'Cache-Control': 'no-cache',
			});
			clients.push(response);
			request.on('close', () => {
				clients = clients.filter(c => c !== response);
			});

			// --- INFO ROUTE ---
		} else if (pathname.startsWith('/info/')) {
			if (method !== 'GET') throw new Error(`Method ${method} not allowed for /info.`);
			const modulePath = pathname.replace('/info/', '');
			const fullPath = path.resolve(process.cwd(), 'src', modulePath);
			const stats = await fs.stat(fullPath);
			const info = {
				path: modulePath,
				fullPath: fullPath,
				isFile: stats.isFile(),
				isDirectory: stats.isDirectory(),
				createdAt: stats.birthtime.toISOString(),
				modifiedAt: stats.mtime.toISOString(),
				size: `${stats.size} bytes`,
			};
			response.writeHead(200, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: true, data: info}));

			// --- INIT ROUTE ---
		} else if (pathname.startsWith('/init/')) {
			if (method !== 'POST') throw new Error(`Method ${method} not allowed for /init.`);
			let modulePath = pathname.replace('/init/', '');
			if (!modulePath.toLowerCase().endsWith('.html')) {
				modulePath = path.join(modulePath, 'index.html');
			}
			const result = await scaffoldModule(modulePath);
			const message = `Scaffolding complete. Created ${result.created.length}, skipped ${result.skipped.length}.`;
			response.writeHead(201, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: true, message, details: result}));

			// --- BUILD ROUTE ---
		} else if (pathname.startsWith('/build/')) {
			if (method !== 'GET') throw new Error(`Method ${method} not allowed for /build.`);
			let modulePath = pathname.replace('/build/', '');
			if (!modulePath.toLowerCase().endsWith('.html')) {
				modulePath = path.join(modulePath, 'index.html');
			}
			const shouldMinify = searchParams.get('minify') === 'true';
			const useLiveReload = searchParams.get('liveReload') === 'true';

			let html = await buildModule(modulePath, shouldMinify);
			if (useLiveReload) {
				const liveReloadScript = `
					<script>
						console.log('[Live Reload] Connecting to dev server...');
						const eventSource = new EventSource('/events');
						eventSource.onmessage = function(event) {
							if (event.data === 'reload') {
								console.log('[Live Reload] Reloading page...');
								window.location.reload();
							}
						};
						eventSource.onerror = function(err) {
							console.error('[Live Reload] Connection error:', err);
						};
					</script>
				`;
				html = html.replace('</body>', `${liveReloadScript}</body>`);
			}
			response.writeHead(200, {'Content-Type': 'text/html'});
			response.end(html);

			// --- NOT FOUND ---
		} else {
			response.writeHead(404, {'Content-Type': 'text/html'});
			response.end('<h1>404 Not Found</h1><p>Please use /ping, /init, /build, or /info endpoints.</p>');
		}

	} catch (error: any) {
		console.error(`Error processing request ${method} ${pathname}:`, error);
		if (error.code === 'ENOENT') {
			response.writeHead(404, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: false, message: `Path not found: ${pathname}`}));
		} else if (error.message.includes('Method not allowed')) {
			response.writeHead(405, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: false, message: error.message}));
		} else {
			const isApiRoute = ['/init', '/info'].some(p => pathname.startsWith(p));
			if (isApiRoute) {
				response.writeHead(500, {'Content-Type': 'application/json'});
				response.end(JSON.stringify({success: false, message: error.message}));
			} else {
				response.writeHead(500, {'Content-Type': 'text/html'});
				response.end(`<h1>500 - Server Error</h1><pre>${error.message}</pre>`);
			}
		}
	}
});

server.listen(PORT, () => {
	console.log(`fmpromise-dev server started at http://localhost:${PORT}`);
	const srcDir = path.join(process.cwd(), 'src');
	console.log(`[Live Reload] Watching for file changes in: ${srcDir}`);
	chokidar.watch(srcDir, {
		ignored: /(^|[\/\\])\../,
		persistent: true,
		ignoreInitial: true,
	}).on('all', () => {
		sendReloadEvent();
	});
});
