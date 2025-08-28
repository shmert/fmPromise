import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const getTemplate = async (templateName: string) => {
	const templatePath = path.join(__dirname, 'templates', templateName);
	return fs.readFile(templatePath, 'utf-8');
};

export const scaffoldModule = async (modulePath: string) => {
	const directory = path.resolve(process.cwd(), 'src', modulePath);
	await fs.mkdir(directory, { recursive: true });

	const htmlTemplate = await getTemplate('module.html');
	const finalHtml = htmlTemplate
		.replace('{{cssFileName}}', 'style.css')
		.replace('{{tsFileName}}', 'module.ts');

	await Promise.all([
		fs.writeFile(path.join(directory, 'index.html'), finalHtml),
		getTemplate('module.css').then(content =>
			fs.writeFile(path.join(directory, 'style.css'), content)
		),
		getTemplate('module.ts').then(content =>
			fs.writeFile(path.join(directory, 'module.ts'), content)
		),
	]);
};