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

export const scaffoldModule = async (htmlFilePath: string): Promise<ScaffoldResult> => {
	const projectRoot = process.cwd();
	const result: ScaffoldResult = {created: [], skipped: []};

	const targetDir = path.resolve(projectRoot, 'src', path.dirname(htmlFilePath));
	await fs.mkdir(targetDir, {recursive: true});

	// --- Create tsconfig.json if it doesn't exist ---
	const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
	if (!(await fileExists(tsconfigPath))) {
		await fs.writeFile(tsconfigPath, tsconfigTemplate, 'utf8');
		result.created.push('tsconfig.json');
	} else {
		result.skipped.push('tsconfig.json');
	}
	// --------------------------------------------------

	const htmlFileName = path.basename(htmlFilePath);
	const templatesDir = path.join(__dirname, 'templates');

	const filesToCreate = [
		{templateName: 'module.html', finalName: htmlFileName},
		{templateName: 'module.ts', finalName: 'main.ts'},
		{templateName: 'module.css', finalName: 'style.css'},
	];

	for (const file of filesToCreate) {
		const finalPath = path.join(targetDir, file.finalName);

		if (await fileExists(finalPath)) {
			result.skipped.push(file.finalName);
		} else {
			const templatePath = path.join(templatesDir, file.templateName);
			await fs.copyFile(templatePath, finalPath);
			result.created.push(file.finalName);
		}
	}

	return result;
};
