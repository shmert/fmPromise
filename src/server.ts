import http from 'http';
import path from 'path';
import {buildModule} from './viteBuilder.js';
import {scaffoldModule} from './scaffolder.js';

const PORT = 4000;

const server = http.createServer(async (request, response) => {
	const {method, url} = request;
	const pathname = url || '/';

	try {
		// --- PING ROUTE ---
		if (method === 'GET' && pathname === '/ping') {
			response.writeHead(200, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: true, message: 'pong'}));

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

			const html = await buildModule(modulePath);
			response.writeHead(200, {'Content-Type': 'text/html'});
			response.end(html);

			// --- NOT FOUND ---
		} else {
			response.writeHead(404, {'Content-Type': 'text/html'});
			response.end('<h1>404 Not Found</h1><p>Please use the <code>/build/path/to/your/module</code> endpoint.</p>');
		}
	} catch (error: any) {
		console.error(`Error processing request ${method} ${pathname}:`, error);

		// Send JSON error for API-like routes (/init)
		if (pathname.startsWith('/init/')) {
			response.writeHead(500, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: false, message: error.message}));

			// Send HTML error for user-facing routes (/build)
		} else if (pathname.startsWith('/build/')) {
			const modulePath = pathname.replace('/build/', '');
			response.writeHead(500, {'Content-Type': 'text/html'});
			response.end(`
				<html>
					<body style="font-family: sans-serif; padding: 2em;">
						<h1>Build Failed: ${modulePath}</h1>
						<hr>
						<h3>Error:</h3>
						<pre style="background: #eee; padding: 1em; border-radius: 5px;">${error.message}</pre>
					</body>
				</html>`);

			// Generic error for other cases
		} else {
			response.writeHead(500, {'Content-Type': 'text/plain'});
			response.end('Internal Server Error');
		}
	}
});

server.listen(PORT, () => {
	console.log(`fmpromise-dev server started at http://localhost:${PORT}`);
});
