import fmPromise from '../fm-promise.js'
fmPromise.setFieldByName('foo', 'bar').then();

// document.addEventListener('load', () => {
	console.log('foo');
	document.getElementById('foo').innerHTML = 'bar';
// })
