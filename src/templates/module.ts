
import fmPromise from '@360works/fmpromise';

async function main() {
	const appElement = document.getElementById('app');
	if (!appElement) return;

	try {
		appElement.textContent = 'Fetching FileMaker data...';
		const userName = await fmPromise.evaluate('Get(UserName)');
		appElement.innerHTML = `
      <p>Hello, <strong>${userName}</strong>!</p>
      <p>This module was scaffolded by fm-promise-server.</p>
    `;
	} catch (error) {
		console.error('Error fetching data from FileMaker:', error);
		appElement.textContent = 'Error communicating with FileMaker. Make sure you are running this in a FileMaker Web Viewer.';
	}
}

main().then();
