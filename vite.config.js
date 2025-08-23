import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the target directory from the environment variable set by our dev server.
const targetView = process.env.VITE_BUILD_TARGET;

// This variable is essential. If it's missing, the build cannot proceed.
if (!targetView) {
    throw new Error(
        'VITE_BUILD_TARGET environment variable not set. ' +
        'This script should be run by the fm-promise-server, which sets this variable.'
    );
}

export default defineConfig({
    root: path.resolve(__dirname, 'examples', targetView),
    base: './',
    plugins: [viteSingleFile()],
    build: {
        outDir: path.resolve(__dirname, 'dist'),
        minify: 'terser',
        emptyOutDir: true
    },

    server: {
        // This allows Vite's dev server to work correctly when loaded from a
        // FileMaker `data:` URL or `file://` protocol in dev mode.
        cors: true
    }
});
