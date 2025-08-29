import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import type { OutputAsset } from 'rollup';

export const buildModule = async (moduleHtmlPath: string): Promise<string> => {
	// e.g., /path/to/project/src/my-module/index.html
	const absoluteInputFile = path.resolve(process.cwd(), 'src', moduleHtmlPath);

	// The fix: The 'root' of the build must be the directory containing the HTML file.
	// This ensures that relative links inside the HTML (like "./module.ts") resolve correctly.
	const buildRoot = path.dirname(absoluteInputFile);

	const result = await build({
		// Use the directory of the target file as the root for this specific build.
		root: buildRoot,
		plugins: [viteSingleFile()],
		logLevel: 'silent',
		build: {
			// Build in memory, not to disk
			write: false,
			// Prevent vite from creating an /assets subfolder in the virtual output
			minify:false,
			assetsDir: '',
			rollupOptions: {
				input: {
					// We can use the absolute path directly for the input.
					index: absoluteInputFile,
				},
			},
		},
	});

	if (!('output' in result)) {
		throw new Error('Vite build did not return a valid output.');
	}

	const htmlAsset = result.output.find(
		(item): item is OutputAsset => item.type === 'asset' && item.fileName.endsWith('.html')
	);

	if (!htmlAsset || typeof htmlAsset.source !== 'string') {
		throw new Error(`Vite build did not produce a valid HTML file for: ${moduleHtmlPath}`);
	}

	return htmlAsset.source;
};
