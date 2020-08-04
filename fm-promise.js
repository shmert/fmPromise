'use strict';

const fmPromise = function () {
	let webViewerName = 'fmPromiseWebViewer';
	let lastPromiseId = 0;
	const callbacksById = {};
	let debugEnabled = null;
	const fmProxy = new Promise((resolve, reject) => {
		let triesLeft = 100;
		const pollingId = window.setInterval(() => {
			// noinspection JSUnresolvedVariable,JSUnresolvedFunction
			if (window.FileMaker) {
				window.clearInterval(pollingId);
				resolve(window.FileMaker);
			} else {
				if (!triesLeft--){
					window.clearInterval(pollingId);
					reject('No window.FileMaker object was loaded after polling timeout.');
				}
			}
		}, 10);
	});

	window.addEventListener("unhandledrejection", event => {
		if (debugEnabled === null) {
			setDebugEnabled(true);
		}
		console.warn(`UNHANDLED ERROR: ${event.reason}`);
		console.trace();
	});

	const setDebugEnabled = (yn) => {
		if (yn === debugEnabled) {
			return; // no change
		}
		debugEnabled = yn;
		let debugNode = document.getElementById('debugLog');
		if (debugEnabled === true) {
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
		} else if (debugEnabled === false) {
			if (debugNode) {
				debugNode.remove();
			}
		}
	};

	return {
		/**
		 * Performs a FileMaker script, returning a Promise. The Promise will be resolved with parsed JSON if possible, or rejected if the FileMaker script result starts with the word "ERROR".
		 * @return {Promise} which will be resolved / rejected by the `scriptName` being called
		 * @param scriptName:string FileMaker script to perform
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
							// noinspection JSCheckFunctionSignatures
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
		 * @param exp:string calculation to evaluate
		 * @param letVars:object key/value pairs which may be used in <code>exp</code>
		 * @return {Promise} containing the evaluated result
		 */
		evaluate(exp, letVars = {}) {
			const letEx = Object.entries(letVars).map((o) => o[0] + '=' + JSON.stringify(o[1])).join(';');
			const stmt = 'Let([' + letEx + '] ; ' + exp + ')';
			console.log('Evaluating stmt ' + stmt);
			return this.performScript('fmPromise.evaluate', stmt);
		},

		/**
		 * Execute a FileMaker Data API call with the given parameter.
		 * @param {{layouts: string, layout.response:undefined|string, action: 'metaData'|'read'|undefined, limit: number|undefined, offset:undefined|number, query:undefined|{omit:undefined|'true'}[], sort:undefined|{fieldName:string,sortOrder:'ascend'|'descend'|undefined}[], portal:undefined|string[]}} param the data API call parameter JSON
		 * @return {Promise<{layouts:undefined|[{name:string,table:string}], fieldMetaData:undefined|[{}], portalMetaData:undefined|[{}], valueLists:undefined|[{}] dataInfo:undefined|{database:string, layout:string, table:string, totalRecordCount:number, foundCount:number, returnedCount:number}, data:undefined|[{fieldData:{}, portalData:{}, portalDataInfo:[{}]}]}>}
		 */
		executeFileMakerDataAPI(param) {
			return this.performScript('fmPromise.executeFileMakerDataAPI', param)
				.then((result) => {
					// do error-checking on the data API result here instead of in FileMaker, as JSON parsing for large payloads is faster
					if (!result || !result.messages || !result.messages.length) {
						throw 'Empty data API response';
					} else if (result.messages[0].code !== '0') {
						throw result.messages[0];
					} else {
						return result.response;
					}
				});
		},

		/**
		 * Executes a SQL command with placeholders, parsing the plain-text delimited result into an array of arrays.
		 * @param sql:string
		 * @param bindings:{}
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
		 * Inserts from URL without worrying about cross-site scripting limitations imposed on the web viewer
		 * @param url:string URL to fetch/post to
		 * @param curlOptions:string @see https://fmhelp.filemaker.com/help/18/fmp/en/index.html#page/FMP_Help/curl-options.html
		 * @return {Promise<string>} the response body. If you need headers, consider writing a custom FileMaker script.
		 */
		insertFromUrl(url, curlOptions) {
			return this.performScript('fmPromise.insertFromURL', {url, curlOptions});
		},

		/**
		 * Sets a field by name in FileMaker.
		 * @param fmFieldNameToSet:string The name of the field, optionally fully qualified
		 * @param value
		 * @return {Promise}
		 */
		setFieldByName(fmFieldNameToSet, value) {
			return this.performScript('fmPromise.setFieldByName', {fmFieldNameToSet, value});
		},

		/**
		 * Shows a dialog in FileMaker, and returns the (one-based!) index of the button chosen
		 * @param title:string
		 * @param body:string
		 * @param btn1:string
		 * @param btn2:string
		 * @param btn3:string
		 * @return {Promise<number>}
		 */
		showCustomDialog(title, body, btn1, btn2, btn3) {
			return this.performScript('fmPromise.showCustomDialog', {title, body, btn1, btn2, btn3})
				.then(function(chosenMessage) {
					// noinspection JSCheckFunctionSignatures
					return parseInt(chosenMessage);
				});
		},

		/**
		 * Private method called by FileMaker to provide a result for a script call.
		 * @return {boolean} whether there was a pending promise with this id
		 */
		_resolve(promiseId, result) {
			console.log('Got resolve for promiseId ' + promiseId + ' with ' + result.length + ' characters');
			callbacksById[promiseId].resolve(result);
			return delete callbacksById[promiseId];
		},

		/**
		 * Private method called by FileMaker to provide an error cause for a script call.
		 * @return {boolean} whether there was a pending promise with this id
		 */
		_reject(promiseId, error) {
			console.log('Got reject for promiseId ' + promiseId + ': ' + error);
			callbacksById[promiseId].reject(error);
			return delete callbacksById[promiseId];
		},

		/**
		 * The default <code>webViewerName</code> is "fmPromiseWebViewer". This corresponds to the webViewer layout object by FileMaker to call back into JavaScript.
		 * @param s:string
		 */
		setWebViewerName(s) {
			webViewerName = s;
		},

		/**
		 * If <code>true</code>, redirects console messages to display at the bottom of the screen, handy for Web Viewer which lacks developer tools.
		 * If <code>false</code>, disabled debugging, removing any debug messages
		 * If <code>null</code> debugging is enabled when an uncaught exception occurs
		 */
		setDebugEnabled,

		/**
		 * Evaluates some arbitrary JavaScript and logs it at the bottom of the screen, turning on debugging via {@link #setDebugEnabled} if not yet enabled.
		 */
		evaluateJS(s) {
			this.setDebugEnabled(true);
			try {
				console.log(eval(s));
			} catch (e) {
				console.error(e);
			}
		},

		/**
		 * Given an html file, this uses fmPromise to get the file contents, parse it as DOM, and inline any external references
		 */
		async package(htmlFileName, fmFieldNameToSet) {
			function byteLengthFormat(num) {
				return '<code>' + new Intl.NumberFormat().format(num) + '</code> bytes';
			}

			const baseUrl = await fmPromise.evaluate("$$DEVMODE_HTML_BASE_URL");
			if (!baseUrl) {
				return alert('You must first set $$DEVMODE_HTML_BASE_URL to the directory containing your html file e.g. file:///Users/myName/myProject/');
			}
			const htmlContents = await fmPromise.insertFromUrl(baseUrl + htmlFileName);
			const listItems = [];
			listItems.push('<code>' + htmlFileName + '</code> original size: ' + byteLengthFormat(htmlContents.length));
			const doc = new DOMParser().parseFromString(htmlContents, 'text/html');
			for (const s of [...doc.getElementsByTagName('script')]) {
				if (s.src) {
					let url = s.src.replace(/.js$/, '.min.js'); // try a minified version first
					try {
						s.innerHTML = await fmPromise.insertFromUrl(url);
					} catch (e) {
						url = s.src; // use the non-minified version
						try {
							s.innerHTML = await fmPromise.insertFromUrl(s.src);
						} catch (e) {
							listItems.push('WARNING! <code>' + url + '</code> could not be fetched');
							const choice = await fmPromise.showCustomDialog('Package Error',
								'Unable to fetch ' + url,
								'Abort',
								'Ignore'
							);
							if (choice === 0) {
								throw('User canceled');
							} else {
								continue;
							}
						}
					}
					listItems.push('<code>' + url + '</code> inlined: ' + byteLengthFormat(s.innerHTML.length));
					s.removeAttribute('src');
				}
			}
			for (const s of [...doc.getElementsByTagName('link')]) {
				if (s.href && s.rel==='stylesheet') {
					let styleNode = document.createElement('style');
					styleNode.innerHTML = await fmPromise.insertFromUrl(s.href);
					s.replaceWith(styleNode);
					listItems.push('<code>' + s.href + '</code> inlined: ' + byteLengthFormat(styleNode.innerText.length));
				}
			}
			let packaged ='<!doctype html>\n' + doc.firstElementChild.outerHTML;
			listItems.push('Final HTML is ' + byteLengthFormat(packaged.length));
			let messageList = document.getElementById('messageList');
			if ( !messageList ) {
				messageList = document.createElement('ul');
				document.body.append(messageList);
			}
			messageList.innerHTML = listItems.map(s=> '<li>' + s + '</li>').join('');
			await fmPromise.setFieldByName(fmFieldNameToSet, packaged);
			return packaged;
		}
	}
}();
