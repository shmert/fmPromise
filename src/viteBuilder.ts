import {build} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import path from 'path';
import type {OutputAsset} from 'rollup';

export const buildModule = async (modulePath: string): Promise<string> => {
	const root = process.cwd();
	const inputFile = path.resolve(root, 'src', modulePath, 'index.html');

	const result = await build({
		root: path.dirname(inputFile),
		plugins: [viteSingleFile()],
		logLevel: 'silent',
		build: {
			write: false,
			rollupOptions: {
				input: {
					index: inputFile,
				},
			},
		},
	});

	// Type guard to ensure we have a RollupOutput with an 'output' array
	if (!('output' in result)) {
		throw new Error('Vite build did not return a valid output.');
	}

	// Find the first OutputAsset in the result, which will be our HTML file.
	const htmlAsset = result.output.find(
		(item): item is OutputAsset => item.type === 'asset'
	);

	if (!htmlAsset || typeof htmlAsset.source !== 'string') {
		throw new Error('Vite build did not produce an HTML asset.');
	}

	return htmlAsset.source;
};
