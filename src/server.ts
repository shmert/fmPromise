import http from 'http';
import { buildModule } from './viteBuilder.js';
import { scaffoldModule } from './scaffolder.js';

const PORT = 4000;

const server = http.createServer(async (request, response) => {
	const { method, url } = request;
	const requestUrl = new URL(url || '/', `http://${request.headers.host}`);
	const pathname = requestUrl.pathname;

	try {
		if (method === 'POST' && pathname.startsWith('/init/')) {
			const modulePath = pathname.replace('/init/', '');
			await scaffoldModule(modulePath);
			response.writeHead(201, { 'Content-Type': 'text/plain' });
			response.end(`Module created at ./src/${modulePath}\n`);

		} else if (method === 'GET' && pathname.startsWith('/build/')) {
			const modulePath = pathname.replace('/build/', '');
			const html = await buildModule(modulePath);
			response.writeHead(200, { 'Content-Type': 'text/html' });
			response.end(html);
		} else {
			response.writeHead(404, { 'Content-Type': 'text/plain' });
			response.end('Not Found\n');
		}
	} catch (error) {
		console.error(error);
		response.writeHead(500, { 'Content-Type': 'text/plain' });
		response.end('Internal Server Error\n' + JSON.stringify(error));
	}
});

server.listen(PORT, () => {
	console.log(`fmpromise-dev server started at http://localhost:${PORT}`);
});
