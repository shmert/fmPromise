import {defineConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import path from 'path';
import {fileURLToPath} from 'url';

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the target directory from the environment variable set by our dev server.
const targetView = process.env.VITE_BUILD_TARGET;

if (!targetView) {
	throw new Error(
		'VITE_BUILD_TARGET environment variable not set. ' +
		'This script should be run by the fm-promise-server, which sets this variable.'
	);
}

export default defineConfig({
	// The root now correctly points directly to the target directory at the project root.
	root: path.resolve(__dirname, targetView),

	base: './',

	plugins: [viteSingleFile()],

	build: {
		outDir: path.resolve(__dirname, 'dist'),
		minify: false,
		emptyOutDir: true
	},

	server: {
		cors: true
	}
});
