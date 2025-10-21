import fmPromise from '@360works/fmpromise';

const appElement = document.getElementById('app')!;

try {
	appElement.textContent = 'Fetching FileMaker data...';
	const userName = await fmPromise.evaluate('Get(UserName)');
	appElement.innerHTML = `
      <p>Hello, <strong>${userName}</strong>!</p>
      <p>This module was scaffolded by the @360works/fmpromise dev server.</p>
      <p>Call the <code>fmPromise.toggleDevMode</code> script to enable / disable devMode</p>
    `;
} catch (error) {
	console.error('Error fetching data from FileMaker:', error);
	appElement.textContent = 'Error communicating with FileMaker. Make sure you are running this in a FileMaker Web Viewer.';
}
