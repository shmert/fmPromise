// vite.config.js
import {defineConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// These will be provided by the fm-promise-server
const targetDir = process.env.VITE_BUILD_TARGET_DIR; // e.g., 'foo'
const entryFile = process.env.VITE_BUILD_ENTRY_FILE;   // e.g., 'hello-world.html'

if (!targetDir || !entryFile) {
	throw new Error('VITE_BUILD_TARGET_DIR and VITE_BUILD_ENTRY_FILE environment variables must be set.');
}

// The two critical paths, constructed dynamically
const rootPath = path.resolve(__dirname, 'src', targetDir);
const inputPath = path.resolve(rootPath, entryFile);

export default defineConfig({
	// The root is now dynamic, based on the server's request.
	root: rootPath,

	base: './',

	plugins: [
		viteSingleFile()
	],

	build: {
		outDir: path.resolve(__dirname, 'dist'),
		emptyOutDir: true,
		minify: true, // Or true, as needed
		cssMinify:true,
		rollupOptions: {
			// The input is the absolute path to the requested HTML file.
			input: inputPath,
		},
		modulePreload: {
			polyfill: false
		}
	},
});
