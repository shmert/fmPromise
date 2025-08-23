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

// Resolve paths relative to the project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.resolve(projectRoot, 'dist');
const schemaDir = path.resolve(projectRoot, 'filemaker-schema');

// --- API ENDPOINTS ---

/**
 * Builds a specific web viewer application using Vite and returns the bundled HTML.
 * This is called by the FileMaker "Dev Assistant" script in "Production" mode.
 */
app.get('/build/:moduleID', (req: Request, res: Response) => {
	const {moduleID} = req.params;

	if (!moduleID || !/^[a-zA-Z0-9_-]+$/.test(moduleID)) {
		return res.status(400).send('Invalid moduleID parameter.');
	}

	console.log(`[Server] Received build request for: ${moduleID}`);

	const buildCommand = 'npx vite build';
	const buildOptions = {
		env: {...process.env, VITE_BUILD_TARGET: moduleID},
		cwd: projectRoot,
	};

	exec(buildCommand, buildOptions, async (error, stdout, stderr) => {
		if (error) {
			console.error(`[Server] Build failed for "${moduleID}": ${error.message}`);
			// Send a formatted error page back to FileMaker for easier debugging
			res.status(500).send(`
                <html>
                    <body style="font-family: sans-serif;">
                        <h1>Build Failed: ${moduleID}</h1>
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

		console.log(`[Server] Build successful for "${moduleID}"`);

		try {
			const bundledHtmlPath = path.join(distDir, 'index.html');
			const bundledHtml = await fs.readFile(bundledHtmlPath, 'utf8');
			console.log(`[Server] Sending bundled file (${(bundledHtml.length / 1024).toFixed(2)} KB).`);
			res.send(bundledHtml);
		} catch (readError) {
			console.error(`[Server] Failed to read bundled file:`, readError);
			res.status(500).send(`Build Succeeded, but could not read the output file.`);
		}
	});
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
    .on('error', (error) => console.error(`[Watcher] Error: ${error}`));

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
