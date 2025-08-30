import http from 'http';
import path from 'path';
import {URL} from 'url';
import chokidar from 'chokidar';
import {buildModule} from './viteBuilder.js';
import {scaffoldModule} from './scaffolder.js';

const PORT = 4000;

// --- Live Reload Connection Manager ---
// This will hold all active client connections for Server-Sent Events.
let clients: http.ServerResponse[] = [];

const sendReloadEvent = () => {
	console.log('[Live Reload] File change detected. Sending reload signal to clients...');
	clients.forEach(client => client.write('data: reload\n\n'));
};

// --- Main Server Logic ---
const server = http.createServer(async (request, response) => {
	const {method, url} = request;
	const requestUrl = new URL(url || '/', `http://${request.headers.host}`);
	const {pathname, searchParams} = requestUrl;
	console.log(`Got ${method} request for ${requestUrl.pathname}`);

	try {
		// --- PING ROUTE ---
		if (method === 'GET' && pathname === '/ping') {
			response.writeHead(200, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: true, message: 'pong'}));

			// --- LIVE RELOAD EVENT STREAM ---
		} else if (method === 'GET' && pathname === '/events') {
			response.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Connection': 'keep-alive',
				'Cache-Control': 'no-cache',
			});
			clients.push(response);
			console.log(`[Live Reload] Client connected. Total clients: ${clients.length}`);

			request.on('close', () => {
				clients = clients.filter(c => c !== response);
				console.log(`[Live Reload] Client disconnected. Total clients: ${clients.length}`);
			});

			// --- INIT ROUTE ---
		} else if (method === 'POST' && pathname.startsWith('/init/')) {
			let modulePath = pathname.replace('/init/', '');
			if (!modulePath.toLowerCase().endsWith('.html')) {
				modulePath = path.join(modulePath, 'index.html');
			}
			const result = await scaffoldModule(modulePath);
			const message = `Scaffolding complete. Created ${result.created.length} file(s). Skipped ${result.skipped.length} existing file(s).`;
			response.writeHead(201, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: true, message, details: result}));

			// --- BUILD ROUTE ---
		} else if (method === 'GET' && pathname.startsWith('/build/')) {
			let modulePath = pathname.replace('/build/', '');
			if (!modulePath.toLowerCase().endsWith('.html')) {
				modulePath = path.join(modulePath, 'index.html');
			}

			const shouldMinify = searchParams.get('minify') === 'true';
			const useLiveReload = searchParams.get('liveReload') === 'true';

			let html = await buildModule(modulePath, shouldMinify);

			// Inject the live reload script if requested
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
			response.end('<h1>404 Not Found</h1><p>Please use the <code>/build/path/to/your/module</code> endpoint.</p>');
		}
	} catch (error: any) {
		console.error(`Error processing request ${method} ${pathname}:`, error);
		if (pathname.startsWith('/init/')) {
			response.writeHead(500, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: false, message: error.message}));
		} else if (pathname.startsWith('/build/')) {
			const modulePath = pathname.replace('/build/', '');
			response.writeHead(500, {'Content-Type': 'text/html'});
			response.end(`
				<html lang="en">
					<body style="font-family: sans-serif; padding: 2em;">
						<h1>Build Failed: ${modulePath}</h1>
						<hr>
						<h3>Error:</h3>
						<pre style="background: #eee; padding: 1em; border-radius: 5px;">${error.message}</pre>
					</body>
				</html>`);
		} else {
			response.writeHead(500, {'Content-Type': 'text/plain'});
			response.end('Internal Server Error');
		}
	}
});

// --- Start Server and File Watcher ---
server.listen(PORT, () => {
	console.log(`fmpromise-dev server started at http://localhost:${PORT}`);

	// Initialize the file watcher
	const srcDir = path.join(process.cwd(), 'src');
	console.log(`[Live Reload] Watching for file changes in: ${srcDir} (for when liveReload=true parameter is used in /build/ requests)`);

	chokidar.watch(srcDir, {
		ignored: /(^|[\/\\])\../, // ignore dotfiles
		persistent: true,
		ignoreInitial: true, // Don't fire on initial scan
	}).on('all', (event, path) => {
		// On any change, send the reload event.
		sendReloadEvent();
	});
});
