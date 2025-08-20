/**
 * @file A modern, promise-based utility for interacting with FileMaker from a web viewer.
 * @module fm-promise
 * @author 360Works
 * @license Apache-2.0
 * @version 2.0.0
 * @see {@link https://github.com/360Works/fm-promise|GitHub Repository}
 */

// --- Type Definitions ---

/**
 * @typedef {Object} PerformScriptOptions
 * @property {boolean} [alwaysReturnString=false] - If true, the promise will always resolve with a string, bypassing automatic JSON parsing.
 * @property {0|1|2|3|4|5} [runningScript=0] - Specifies how to handle a currently running FileMaker script.
 *   0: Continue (default); 1: Halt; 2: Exit; 3: Resume; 4: Pause; 5: Interrupt.
 * @see {@link https://help.claris.com/en/pro-help/content/filemaker-performscriptwithoption.html|FileMaker.PerformScriptWithOption documentation}
 */

/**
 * @typedef {Object} DataAPIRequest
 * @property {string} layouts - The name of the layout to perform the action on.
 * @property {'metaData'|'read'|'create'|'update'|'delete'|'duplicate'} [action] - The Data API action to perform.
 * @property {number} [limit] - The maximum number of records to return.
 * @property {number} [offset] - The number of records to skip before returning results.
 * @property {Object[]} [query] - An array of find request objects.
 * @property {Array<{fieldName: string, sortOrder: 'ascend'|'descend'}>} [sort] - An array of sort objects.
 * @property {string[]} [portal] - An array of portal names to include in the result.
 */

/**
 * @typedef {Object} DataAPIResponse - The top-level response from a Data API call.
 * @property {Array<{code: string, message: string}>} messages - An array of result messages.
 * @property {Object} response - The main response data payload.
 */

// --- Private Variables ---

let lastPromiseId = 0;
const callbacksById = {};

/**
 * A modern, class-based custom error for cleaner, more standard error handling.
 * This error is thrown when a FileMaker script call fails or a Data API request returns an error code.
 * @property {string|number|undefined} code - The FileMaker or Data API error code, if available.
 */
class FMPromiseError extends Error {
	constructor({message = 'Unknown error', code}) {
		super(message);
		this.name = 'FMPromiseError';
		this.code = code;
	}

	toString() {
		return this.code ? `${this.message} (${this.code})` : this.message;
	}
}

/**
 * A promise that resolves to the global `FileMaker` object.
 * It includes a 5-second timeout to prevent the application from hanging indefinitely
 * if the `FileMaker` object is never defined (e.g., when debugging in a browser).
 * @internal
 */
const fmProxy = Promise.race([
	new Promise((resolve) => {
		if (window.FileMaker) {
			resolve(window.FileMaker);
		} else {
			let _fileMaker;
			Object.defineProperty(window, 'FileMaker', {
				get: () => _fileMaker,
				set: (v) => resolve(_fileMaker = v)
			});
		}
	}),
	new Promise((_, reject) =>
		setTimeout(() => reject(new FMPromiseError({message: 'FileMaker object not found within 5 seconds.'})), 5000)
	)
]);

/**
 * fmPromise helps you utilize web viewers in your solution with the minimum amount of fuss.
 */
const fmPromise = {
	/**
	 * The name of the web viewer object in FileMaker. This is crucial for FileMaker to call back into JavaScript.
	 * It can be set via URL parameter `?webViewerName=...` or by setting `document.$FMP_WEB_VIEWER_NAME` before this script loads.
	 * @type {string}
	 */
	webViewerName: document.$FMP_WEB_VIEWER_NAME || new URLSearchParams(window.location.search).get('webViewerName') || 'fmPromiseWebViewer',

	/**
	 * Performs a FileMaker script and returns a Promise.
	 * This is the core function of the library.
	 * @param {string} scriptName - The name of the FileMaker script to perform.
	 * @param {any} [scriptParameter=null] - The parameter to pass to the script. Non-string values will be JSON stringified.
	 * @param {PerformScriptOptions} [options={}] - Options for the script call.
	 * @returns {Promise<any>} A promise that resolves with the script result, or rejects with an `FMPromiseError`.
	 * @throws {FMPromiseError} If the FileMaker script rejects or the `FileMaker` object is not found.
	 * @example
	 * // Simple call
	 * const result = await fmPromise.performScript('My Script');
	 *
	 * // Call with parameters and options
	 * const user = { id: 123, name: 'John Doe' };
	 * const createdUser = await fmPromise.performScript('Create User', user, { runningScript: 1 });
	 * console.log(createdUser); // Logs the JSON result from the script
	 */
	async performScript(scriptName, scriptParameter = null, options = {}) {
		const promiseId = ++lastPromiseId;
		console.log(`[fmPromise] #${promiseId}: Calling script "${scriptName}"`, scriptParameter);

		if (scriptParameter && typeof scriptParameter !== 'string') {
			scriptParameter = JSON.stringify(scriptParameter);
		}

		const fm = await fmProxy;

		let result = await new Promise((resolve, reject) => {
			callbacksById[promiseId] = {resolve, reject};
			const meta = JSON.stringify({scriptName, promiseId, webViewerName: this.webViewerName});
			const comboParam = meta + '\n' + scriptParameter;
			const option = options.runningScript || 0;

			if (option === 0) {
				fm.PerformScript('fmPromise', comboParam);
			} else {
				fm.PerformScriptWithOption('fmPromise', comboParam, option);
			}
		});

		if (!options.alwaysReturnString && typeof result === 'string' && (result.startsWith('{') || result.startsWith('['))) {
			try {
				result = JSON.parse(result);
			} catch (e) {
				console.warn(`[fmPromise] #${promiseId}: Unable to parse JSON result.`, {result, error: e});
			}
		}

		console.log(`[fmPromise] #${promiseId}: Received result.`, result);
		return result;
	},

	/**
	 * Evaluates an expression in FileMaker, optionally within the context of `Let` variables.
	 * @param {string} expression - The calculation expression to evaluate.
	 * @param {Object<string, any>} [letVars={}] - Key-value pairs to be defined as variables in a `Let()` function.
	 * @param {PerformScriptOptions} [options={}] - Options for the script call.
	 * @returns {Promise<any>} A promise that resolves with the evaluated result.
	 * @throws {FMPromiseError}
	 */
	evaluate(expression, letVars = {}, options = {}) {
		const letEx = Object.entries(letVars || {}).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(';');
		const stmt = `Let([${letEx}] ; ${expression})`;
		return this.performScript('fmPromise.evaluate', stmt, options);
	},

	/**
	 * Executes a FileMaker Data API query.
	 * @param {DataAPIRequest} params - The Data API request parameters.
	 * @returns {Promise<Object>} A promise that resolves with the `response` object from the Data API result.
	 * @throws {FMPromiseError} If the Data API returns an error.
	 */
	async executeFileMakerDataAPI(params) {
		const result = await this.performScript('fmPromise.executeFileMakerDataAPI', params);
		if (!result || !result.messages || !result.messages.length) {
			throw new FMPromiseError({code: -1, message: 'Empty data API response'});
		}
		if (result.messages[0].code !== '0') {
			throw new FMPromiseError(result.messages[0]);
		}
		return result.response;
	},

	/**
	 * A convenience wrapper for `executeFileMakerDataAPI` that returns just the record data.
	 * @param {DataAPIRequest} params - The Data API request parameters.
	 * @returns {Promise<Array<Object>>} A promise resolving to an array of record objects.
	 *   The array is enhanced with `foundCount` and `totalRecordCount` properties.
	 * @throws {FMPromiseError}
	 */
	async executeFileMakerDataAPIRecords(params) {
		const response = await this.executeFileMakerDataAPI(params);
		const arr = response.data.map(o => {
			const rec = {...o.fieldData, ...o.portalData};
			Object.defineProperties(rec, {
				recordId: {value: o.recordId, enumerable: false},
				modId: {value: o.modId, enumerable: false}
			});
			return rec;
		});

		Object.defineProperties(arr, {
			foundCount: {value: response.dataInfo.foundCount, enumerable: false},
			totalRecordCount: {value: response.dataInfo.totalRecordCount, enumerable: false},
		});
		return arr;
	},

	/**
	 * Executes a SQL query using FileMaker's `ExecuteSQL` function.
	 * This method can be called in two ways:
	 * 1. As a standard function with a SQL string and parameter bindings.
	 * 2. As a tagged template literal for safe, inline parameter binding.
	 *
	 * @param {string | TemplateStringsArray} sqlOrStrings - The SQL query string, or the string parts from a template literal.
	 * @param {...any} bindings - Values to bind to the `?` placeholders in the SQL query.
	 * @returns {Promise<Array<Array<string>>>} A promise resolving to an array of rows, where each row is an array of string values.
	 * @throws {FMPromiseError} If the arguments are invalid or the query fails.
	 *
	 * @example <caption>1. Standard function call</caption>
	 * const status = 'Active';
	 * const results = await fmPromise.executeSql('SELECT * FROM Users WHERE Status = ?', status);
	 *
	 * @example <caption>2. Tagged template literal call</caption>
	 * const status = 'Active';
	 * const results = await fmPromise.executeSql`SELECT * FROM Users WHERE Status = ${status}`;
	 */
	async executeSql(sqlOrStrings, ...bindings) {
		let sql;
		let finalBindings;

		// Check if called as a tagged template literal
		if (Array.isArray(sqlOrStrings) && Array.isArray(sqlOrStrings.raw)) {
			if (bindings.length !== sqlOrStrings.length - 1) {
				throw new FMPromiseError({code: -1, message: 'Invalid template literal for executeSql'});
			}
			sql = sqlOrStrings.join('?').replace(/\n\s*/g, ' ');
			finalBindings = bindings;
		}
		// Assume standard function call
		else if (typeof sqlOrStrings === 'string') {
			sql = sqlOrStrings;
			finalBindings = bindings;
		}
		// Invalid call signature
		else {
			throw new FMPromiseError({code: -1, message: 'Invalid arguments: executeSql must be called with a SQL string, or as a template literal.'});
		}

		const p = finalBindings.map((o) => ` ; ${JSON.stringify(o)}`).join('');
		const colDelim = `|${Math.random()}|`;
		const rowDelim = `~${Math.random()}~`;

		const rawData = await this.evaluate(`ExecuteSQLe(${JSON.stringify(sql)} ; "${colDelim}" ; "${rowDelim}"${p})`, undefined, {alwaysReturnString: true});

		if (rawData === '' || rawData === null || rawData === undefined) {
			return [];
		}
		return rawData.split(rowDelim).map((r) => r.split(colDelim));
	},

	/**
	 * Calls a FileMaker script to perform an "Insert from URL" script step.
	 * @param {string} url - The URL to fetch/post to.
	 * @param {string} [curlOptions=''] - cURL options for the request.
	 * @returns {Promise<string>} The response body.
	 * @throws {FMPromiseError}
	 */
	insertFromUrl(url, curlOptions = '') {
		return this.performScript('fmPromise.insertFromURL', {url, curlOptions});
	},

	/**
	 * Calls a FileMaker script to set a field's value by its fully qualified name.
	 * @param {string} fmFieldNameToSet - The name of the field (e.g., "MyTable::MyField").
	 * @param {any} value - The value to set.
	 * @returns {Promise<any>}
	 * @throws {FMPromiseError}
	 */
	setFieldByName(fmFieldNameToSet, value) {
		return this.performScript('fmPromise.setFieldByName', {fmFieldNameToSet, value});
	},

	/**
	 * Shows a custom dialog in FileMaker.
	 * @param {string} title - The dialog title.
	 * @param {string} body - The dialog message.
	 * @param {string} [btn1='OK'] - The label for the first button (default).
	 * @param {string} [btn2=''] - The label for the second button (optional).
	 * @param {string} [btn3=''] - The label for the third button (optional).
	 * @returns {Promise<0|1|2|3>} A promise resolving to the 1-based index of the button clicked (1, 2, or 3). Resolves 0 if no button is clicked.
	 * @throws {FMPromiseError}
	 */
	async showCustomDialog(title, body, btn1 = 'OK', btn2 = '', btn3 = '') {
		const chosenMessage = await this.performScript('fmPromise.showCustomDialog', {title, body, btn1, btn2, btn3});
		return parseInt(chosenMessage, 10);
	},

	/**
	 * Internal method called by the FileMaker `fmPromise` script to resolve a pending promise.
	 * @param {number} promiseId - The ID of the promise to resolve.
	 * @param {any} result - The result from the FileMaker script.
	 * @internal
	 */
	_resolve(promiseId, result) {
		if (callbacksById[promiseId]) {
			callbacksById[promiseId].resolve(result);
			delete callbacksById[promiseId];
		}
	},

	/**
	 * Internal method called by the FileMaker `fmPromise` script to reject a pending promise.
	 * @param {number} promiseId - The ID of the promise to reject.
	 * @param {string} errorString - A string (often JSON) describing the error.
	 * @internal
	 */
	_reject(promiseId, errorString) {
		if (callbacksById[promiseId]) {
			let errorObj;
			try {
				errorObj = JSON.parse(errorString);
			} catch (e) {
				errorObj = {message: errorString};
			}
			console.warn(`[fmPromise] #${promiseId}: Rejected.`, errorObj);
			callbacksById[promiseId].reject(new FMPromiseError(errorObj));
			delete callbacksById[promiseId];
		}
	}
};

// Assign to the window object so FileMaker can find it, making setup automatic for the consumer.
window.fmPromise = globalThis.fmPromise = fmPromise;

export default fmPromise;
