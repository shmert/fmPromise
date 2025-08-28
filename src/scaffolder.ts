import fs from 'fs/promises';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fileExists = (filePath: string) => fs.access(filePath).then(() => true).catch(() => false);

interface ScaffoldResult {
	created: string[];
	skipped: string[];
}

export const scaffoldModule = async (htmlFilePath: string): Promise<ScaffoldResult> => {
	const result: ScaffoldResult = {created: [], skipped: []};

	const targetDir = path.resolve(process.cwd(), 'src', path.dirname(htmlFilePath));
	await fs.mkdir(targetDir, {recursive: true});

	const htmlFileName = path.basename(htmlFilePath);
	const tsFileName = 'module.ts';
	const cssFileName = 'style.css';

	const templatesDir = path.join(__dirname, 'templates');
	const [htmlTemplate, tsTemplate, cssTemplate] = await Promise.all([
		fs.readFile(path.join(templatesDir, 'module.html'), 'utf8'),
		fs.readFile(path.join(templatesDir, 'module.ts'), 'utf8'),
		fs.readFile(path.join(templatesDir, 'module.css'), 'utf8'),
	]);

	const filesToCreate = [
		{
			path: path.join(targetDir, htmlFileName),
			content: htmlTemplate.replace('{{tsFileName}}', tsFileName).replace('{{cssFileName}}', cssFileName)
		},
		{
			path: path.join(targetDir, tsFileName),
			content: tsTemplate
		},
		{
			path: path.join(targetDir, cssFileName),
			content: cssTemplate
		},
	];

	for (const file of filesToCreate) {
		if (await fileExists(file.path)) {
			result.skipped.push(path.basename(file.path));
		} else {
			await fs.writeFile(file.path, file.content, 'utf8');
			result.created.push(path.basename(file.path));
		}
	}

	return result;
};
