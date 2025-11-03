import {build} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import path from 'path';
import type {OutputAsset} from 'rollup';

// Update the function signature to accept the minify flag
export const buildModule = async (moduleHtmlPath: string, minify: boolean, configJsonString?: string | null): Promise<string> => {
	const absoluteInputFile = path.resolve(process.cwd(), 'src', moduleHtmlPath);
	const buildRoot = path.dirname(absoluteInputFile);

	const result = await build({
		root: buildRoot,
		plugins: [viteSingleFile()],
		logLevel: 'silent',
		build: {
			write: false,
			assetsDir: '',
			// Use the passed-in boolean to control minification
			minify: minify,
			rollupOptions: {
				input: {
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

	let finalHtml = htmlAsset.source;
	if (configJsonString) {
		finalHtml += `<script>window.FMPROMISE_CONFIG = ${configJsonString};</script>`;
	}
	return finalHtml;
};
