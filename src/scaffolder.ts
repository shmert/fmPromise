import fs from 'fs/promises';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fileExists = (filePath: string) => fs.access(filePath).then(() => true).catch(() => false);

interface ScaffoldResult {
	created: string[];
	skipped: string[];
}

const tsconfigTemplate = `{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
`;


export const scaffoldModule = async (htmlFilePath: string, originalPath: string): Promise<ScaffoldResult> => {
	const projectRoot = process.cwd();
	const result: ScaffoldResult = { created: [], skipped: [] };

	const targetDir = path.resolve(projectRoot, 'src', path.dirname(htmlFilePath));
	await fs.mkdir(targetDir, { recursive: true });

	const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
	if (!(await fileExists(tsconfigPath))) {
		await fs.writeFile(tsconfigPath, tsconfigTemplate, 'utf8');
		result.created.push('tsconfig.json');
	} else {
		result.skipped.push('tsconfig.json');
	}

	const htmlFileName = path.basename(htmlFilePath);

	// Get the module name from the ORIGINAL path, not the final file path
    const moduleName = path.basename(originalPath);

	// Calculate the full, absolute path for display
	const absoluteModulePath = path.resolve(projectRoot, 'src', htmlFilePath);

	const templatesDir = path.join(__dirname, 'templates');
	const filesToCreate = [
		{ templateName: 'module.html', finalName: htmlFileName },
		{ templateName: 'main.ts', finalName: 'main.ts' },
		{ templateName: 'style.css', finalName: 'style.css' },
	];

	for (const file of filesToCreate) {
		const finalPath = path.join(targetDir, file.finalName);
		const templatePath = path.join(templatesDir, file.templateName);

		if (await fileExists(finalPath)) {
			result.skipped.push(file.finalName);
			continue;
		}

		if (file.templateName === 'module.html') {
			const templateContent = await fs.readFile(templatePath, 'utf8');

			// Use the correct variables for replacement
			const newContent = templateContent
				.replace(/{{MODULE_NAME}}/g, moduleName)
				.replace(/{{MODULE_PATH}}/g, absoluteModulePath);

			await fs.writeFile(finalPath, newContent, 'utf8');
			result.created.push(file.finalName);
		} else {
			await fs.copyFile(templatePath, finalPath);
			result.created.push(file.finalName);
		}
	}

	return result;
};
