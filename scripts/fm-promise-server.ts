#!/usr/bin/env tsx
import express, {Request, Response} from 'express';
import {exec} from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import {fileURLToPath} from 'url';
import chokidar from 'chokidar';
import {generateTypesFromXml} from './generate-types.js';

// --- SETUP ---
const PORT = 4000;
const app = express();

const fileExists = (filePath: string) => fs.access(filePath, fs.constants.F_OK).then(() => true).catch(() => false);

// Resolve paths relative to the project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.resolve(projectRoot, 'dist');
const schemaDir = path.resolve(projectRoot, 'filemaker-schema');

// --- API ENDPOINTS ---
/**
 * Builds a specific web viewer application using Vite and returns the bundled HTML.
 * - If path ends in .html, it builds that file.
 * - Otherwise, it assumes the path is a directory and builds its index.html.
 */
app.get('/build/{*path}', (req: Request, res: Response) => {
	// @ts-ignore
	let requestedPath = (req.params.path as string[] || []).join('/');

	if (!requestedPath) {
		return res.status(400).send('<h1>Build Error</h1><p>No build path specified.</p>');
	}

	if (!requestedPath.toLowerCase().endsWith('.html')) {
		// Use path.join to correctly handle the optional trailing slash.
		requestedPath = path.join(requestedPath, 'index.html');
	}

	// Determine the target directory and the entry filename
	const buildTargetDir = path.dirname(requestedPath);
	const buildEntryFile = path.basename(requestedPath);

	console.log(`[Server] Received build request for: src/${requestedPath}`);

	const buildCommand = 'npx vite build';
	const buildOptions = {
		env: {
			...process.env,
			VITE_BUILD_TARGET_DIR: buildTargetDir,
			VITE_BUILD_ENTRY_FILE: buildEntryFile,
		},
		cwd: projectRoot,
	};

	exec(buildCommand, buildOptions, async (error, stdout, stderr) => {
		console.log(`[Server] Vite stdout:\n${stdout}`);
		if (stderr) {
			console.error(`[Server] Vite stderr:\n${stderr}`);
		}

		if (error) {
			console.error(`[Server] Build failed for "src/${requestedPath}": ${error.message}`);
			res.status(500).send(`
				<html>
					<body style="font-family: sans-serif;">
						<h1>Build Failed: src/${requestedPath}</h1>
						<hr>
						<h3>Error Message:</h3>
						<pre style="background: #eee; padding: 1em;">${error.message}</pre>
						<h3>Standard Error:</h3>
						<pre style="background: #eee; padding: 1em;">${stderr}</pre>
						<h3>Standard Output:</h3>
						<pre style="background: #eee; padding: 1em;">${stdout}</pre>
					</body>
				</html>`);
			return;
		}

		console.log(`[Server] Build successful for "src/${requestedPath}"`);

		try {
			// Vite's output file will be named after the input file, in the dist dir.
			const outputFileName = path.basename(requestedPath);
			const bundledHtmlPath = path.join(distDir, outputFileName);

			console.log(`[Server] Attempting to read bundled file from: ${bundledHtmlPath}`);
			const bundledHtml = await fs.readFile(bundledHtmlPath, 'utf8');
			console.log(`[Server] Sending bundled file (${(bundledHtml.length / 1024).toFixed(2)} KB).`);
			res.send(bundledHtml);
		} catch (readError) {
			console.error(`[Server] Failed to read bundled file:`, readError);
			res.status(500).send(`Build Succeeded, but could not read the output file.`);
		}
	});
});

/**
 * Scaffolds a new web viewer module in the src directory.
 * Expects a path like "my-module" or "my-module/app.html".
 */
app.post('/init/{*path}', async (req: Request, res: Response) => {
	// @ts-ignore
	const requestedPath = (req.params.path as string[] || []).join('/');
	if (!requestedPath) {
		return res.status(400).send({ error: 'Module path cannot be empty.' });
	}

	const srcDir = path.resolve(projectRoot, 'src');
	const templatesDir = path.resolve(__dirname, 'templates');

	let targetDir: string;
	let htmlFileName: string;
	const tsFileName = 'main.ts';
	const cssFileName = 'styles.css';

	if (requestedPath.toLowerCase().endsWith('.html')) {
		targetDir = path.join(srcDir, path.dirname(requestedPath));
		htmlFileName = path.basename(requestedPath);
	} else {
		targetDir = path.join(srcDir, requestedPath);
		htmlFileName = 'index.html';
	}

	const htmlPath = path.join(targetDir, htmlFileName);
	const tsPath = path.join(targetDir, tsFileName);
	const cssPath = path.join(targetDir, cssFileName);

	console.log(`[Server] Processing init request for module at: ${targetDir}`);

	try {
		// Ensure the target directory exists before we start processing files
		await fs.mkdir(targetDir, { recursive: true });

		// Read the raw template files once
		const [htmlTemplate, tsTemplate, cssTemplate] = await Promise.all([
			fs.readFile(path.join(templatesDir, 'module.html'), 'utf8'),
			fs.readFile(path.join(templatesDir, 'module.ts'), 'utf8'),
			fs.readFile(path.join(templatesDir, 'module.css'), 'utf8'),
		]);

		// Prepare a list of files to process
		const filesToProcess = [
			{ path: htmlPath, content: htmlTemplate.replace('{{tsFileName}}', tsFileName).replace('{{cssFileName}}', cssFileName) },
			{ path: tsPath, content: tsTemplate },
			{ path: cssPath, content: cssTemplate },
		];

		// Process each file: write it if it doesn't exist, and record the outcome.
		const results = await Promise.all(filesToProcess.map(async (file) => {
			if (await fileExists(file.path)) {
				console.log(`[Server] -> File exists, skipping: ${path.basename(file.path)}`);
				return { path: file.path, status: 'exists' };
			} else {
				await fs.writeFile(file.path, file.content, 'utf8');
				console.log(`[Server] -> File created: ${path.basename(file.path)}`);
				return { path: file.path, status: 'created' };
			}
		}));

		const createdFiles = results.filter(r => r.status === 'created').map(r => path.basename(r.path));
		const existingFiles = results.filter(r => r.status === 'exists').map(r => path.basename(r.path));

		let message = '';
		if (createdFiles.length > 0) {
			message += `${createdFiles.join(', ')} ${createdFiles.length > 1 ? 'were' : 'was'} created. `;
		}
		if (existingFiles.length > 0) {
			message += `${existingFiles.join(', ')} already ${existingFiles.length > 1 ? 'exist' : 'exists'} and ${existingFiles.length > 1 ? 'were' : 'was'} not changed.`;
		}
		// --- END: Added code ---

		res.status(200).send({
			success: true,
			message: message.trim(), // Add the new message here
			absolutePath: htmlPath,
			files: results
		});

	} catch (error) {
		console.error(`[Server] ✘ Failed to process module at "${requestedPath}":`, error);
		res.status(500).send({ error: 'An unexpected error occurred on the server.' });
	}
});

/**
 * A simple endpoint to check if the server is running.
 */
app.get('/ping', (req: Request, res: Response) => {
	res.status(200).send('pong');
});

app.get('{*path}', (req: Request, res: Response) => {
	// Avoid redirecting the root path or favicon requests which browsers often make.
	res.status(404).send('<h1>Not Found</h1><p>Please use the /build/path endpoint.</p>');
	return;
});

// --- FILE WATCHER FOR TYPE GENERATION ---

/**
 * Calls the type generation logic when a schema file changes.
 * @param {string} xmlFilePath - The path to the changed XML file.
 */
async function handleSchemaChange(xmlFilePath: string): Promise<void> {
	// Filter out any non-XML files that the watcher might pick up (e.g., .DS_Store)
	if (!xmlFilePath.toLowerCase().endsWith('.xml')) {
		return;
	}

	const fileName = path.basename(xmlFilePath);
	console.log(`[Watcher] XML file event detected: ${fileName}.`);
	try {
		await generateTypesFromXml(xmlFilePath, projectRoot);
	} catch (e) {
		console.error(`[Watcher] Error generating types for ${fileName}:`, e);
	}
}

console.log(`[Watcher] Initializing schema watcher...`);
// Chokidar v4 watches directories; we filter for .xml files in the handler.
const watcher = chokidar.watch(schemaDir, {
	persistent: true,
	awaitWriteFinish: {
		stabilityThreshold: 250,
	},
});

watcher
	.on('add', (path: string) => handleSchemaChange(path))
	.on('change', (path: string) => handleSchemaChange(path))
	.on('ready', () => console.log('[Watcher] Initial scan complete. Ready for changes in the schema directory.'))
	.on('error', (error: any) => console.error(`[Watcher] Error: ${error}`));

// --- START SERVER ---


app.listen(PORT, async () => {
	// Ensure the schema directory and its instructional README exist on startup
	const readmePath = path.join(schemaDir, 'README.md');
	const readmeContent = `# FileMaker Schema Directory

This directory is watched by the fm-promise-server to automatically generate TypeScript type definitions for your FileMaker solutions.

### Instructions

1.  In FileMaker Pro, open your solution and go to **File > Tools > Save a Copy as XML...**
2.  Save the XML file **directly into this directory**.

### Naming Convention is Important!

The name of the XML file determines the TypeScript namespace for your types.

-   **Rule:** Name the file after your solution (e.g., \`YoyodyneAccounting.xml\`).
-   **Result:** The server will generate a namespace called \`YoyodyneAccounting\`. Spaces and special characters will be removed.

These generated types will give you powerful autocompletion for the Data API in your IDE.
`;

	try {
		await fs.mkdir(schemaDir, {recursive: true});
		// The 'wx' flag ensures this only writes the file if it does not already exist.
		await fs.writeFile(readmePath, readmeContent, {flag: 'wx'});
		console.log(`[Server] Created instructional README at: ${readmePath}`);
	} catch (error: any) {
		if (error.code !== 'EEXIST') { // 'EEXIST' means the file already exists, which is fine.
			console.error(`[Server] Could not create schema directory or README.`, error);
		}
	}

	console.log(`[Server] fm-promise-server is running on http://localhost:${PORT}`);
	console.log(`[Server] Waiting for build requests from FileMaker...`);
	console.log(`[Watcher] Watching for schema changes in: ${schemaDir}`);
});
