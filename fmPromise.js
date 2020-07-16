'use strict';

const fmPromise = function () {
	let webViewerName = 'fmPromiseWebViewer';
	let lastPromiseId = 0;
	const callbacksById = {};
	const fmProxy = new Promise((resolve) => {
		let triesLeft = 100;
		const pollingId = window.setInterval(() => {
			// noinspection JSUnresolvedVariable,JSUnresolvedFunction
			if (window.FileMaker) {
				window.clearInterval(pollingId);
				resolve(window.FileMaker);
			} else {
				if (triesLeft-- > 0) {
					// keep trying
				} else {
					window.clearInterval(pollingId);
					console.error('No window.FileMaker object was loaded after polling timeout. Using mock instance for debugging outside of FileMaker');
					resolve({
						PerformScript: () => {
							throw ('FileMaker.PerformScript not supported in mock instance');
						}
					})
				}
			}
		}, 10);
	});

	window.addEventListener("unhandledrejection", event => {
		console.warn(`UNHANDLED ERROR: ${event.reason}`);
	});

	return {
		/**
		 * Performs a FileMaker script, returning a Promise. The Promise will be resolved with parsed JSON if possible, or rejected if the FileMaker script result starts with the word "ERROR".
		 * @return Promise which will be resolved / rejected by the `scriptName` being called
		 * @param scriptName FileMaker script to perform
		 * @param scriptParameter optional parameter to pass to the script
		 */
		performScript(scriptName, scriptParameter) {
			if (scriptParameter && typeof scriptParameter !== 'string') {
				scriptParameter = JSON.stringify(scriptParameter);
			}
			const promiseId = ++lastPromiseId;
			const meta = JSON.stringify({scriptName, promiseId, webViewerName});
			return fmProxy
				.then((fm) => {
					return new Promise((resolve, reject) => {
						callbacksById[promiseId] = {resolve, reject};
						console.log('Performing script ' + scriptName + ' with param ' + scriptParameter + ' promiseId ' + promiseId);
						// noinspection JSUnresolvedFunction
						fm.PerformScript('fmPromise', meta + '\n' + scriptParameter);
					})
				})
				.then((result) => { // try parsing FM result if it looks like JSON
					if (result && result[0] === '{' || result[0] === '[') {
						try {
							result = JSON.parse(result);
						} catch (e) {
							console.warn('Unable to parse JSON result ' + result + ': ' + e);
						}
					}
					return result;
				});
		},

		/**
		 * Evaluate an expression in FileMaker using optional letVars. This is also a handy way to set $$GLOBAL variables.
		 * @param exp calculation to evaluate
		 * @param letVars key/value pairs which may be used in <code>exp</code>
		 * @return Promise containing the evaluated result
		 */
		evaluate(exp, letVars = {}) {
			const letEx = Object.entries(letVars).map((o) => o[0] + '=' + JSON.stringify(o[1])).join(';');
			const stmt = 'Let([' + letEx + '] ; ' + exp + ')';
			console.log('Evaluating stmt ' + stmt);
			return this.performScript('fmPromise.Evaluate', stmt);
		},

		/**
		 * Executes a SQL command with placeholders, parsing the plain-text delimited result into an array of arrays.
		 * @param sql
		 * @param bindings
		 * @return {Promise<Array<Array<String>>>}
		 */
		executeSql(sql, ...bindings) {
			const p = bindings.map((o) => ' ; ' + JSON.stringify(o)).join('');
			return this.evaluate('ExecuteSQL(' + JSON.stringify(sql) + ' ; "~COL~" ; "~ROW~"' + p + ' )')
				.then((rawData) => {
					return rawData.split('~ROW~').map((r) => r.split('~COL~'));
				});

		},

		/**
		 * Called by FileMaker to provide a result for a script call.
		 * @return boolean whether there was a pending promise with this id
		 */
		resolve(promiseId, result) {
			console.log('Got resolve for promiseId ' + promiseId + ' with ' + result.length + ' characters');
			callbacksById[promiseId].resolve(result);
			return delete callbacksById[promiseId];
		},

		/**
		 * Called by FileMaker to provide an error cause for a script call.
		 * @return boolean whether there was a pending promise with this id
		 */
		reject(promiseId, error) {
			console.log('Got reject for promiseId ' + promiseId + ': ' + error);
			callbacksById[promiseId].reject(error);
			return delete callbacksById[promiseId];
		},

		/**
		 * The default <code>webViewerName</code> is "fmPromiseWebViewer". This corresponds to the webViewer layout object by FileMaker to call back into JavaScript.
		 */
		setWebViewerName(s) {
			webViewerName = s;
		},

		/**
		 * Redirects console messages to display at the bottom of the screen, handy for Web Viewer which lacks developer tools.
		 * @return {string}
		 */
		enableDebugging() {
			if (document.getElementById('debugLog')) {
				return 'OK'; // already enabled
			}
			try {
				const debugLog = document.createElement('pre');
				debugLog.id = 'debugLog';
				document.body.appendChild(debugLog);
				// alert('Enabling debug');
				console.log = console.warn = console.error = function () {
					debugLog.append('\n' + new Date() + '\t' + [...arguments].join(' '));
				};
				console.log('Debugging enabled');
				return 'OK';
			} catch (e) {
				alert('Unable to enable debugging: ' + e);
			}
		},
	}
}();
