// --- Type Definitions ---

export type FMPromiseScriptRunningOption = 0 | 1 | 2 | 3 | 4 | 5;

/** Options for the `performScript` call, mirroring FileMaker's `Perform Script with Option`. */
export interface PerformScriptOptions {
	/** If true, the promise will always resolve with a string, bypassing automatic JSON parsing. */
	alwaysReturnString?: boolean;
	/** Specifies how to handle a currently running FileMaker script. 0: Continue (default); 1: Halt; 2: Exit; 3: Resume; 4: Pause; 5: Interrupt. */
	runningScript?: FMPromiseScriptRunningOption,
	/** If performScript will cause the WebViewer to go away, pass `true` here to avoid errors about "Unable to locate web viewer named…" */
	ignoreResult?: boolean;
}

export interface SortPart {
	fieldName: string,
	sortOrder?: 'ascend' | 'descend'
}

/** Parameters for a FileMaker Data API request. */
export interface DataAPIRequest {
	/** Defaults to 'read'. */
	action?: 'read' | 'metaData' | 'create' | 'update' | 'delete' | 'duplicate'
	/** Defaults to 'v1'. */
	version?: 'v1' | 'v2' | 'vLatest'
	/** The name of the layout to perform the action on. */
	layouts: string;
	/** A table occurrence name. Required for table occurrence metaData actions. Works like the layouts key. If the table occurrence is specified, the metadata for that table is returned. If no name is specified, the list of table occurrences is returned.. */
	tables?: string;
	/** An array of find request objects, e.g. `{qty: ">1"}`. */
	query?: Record<string, string>[];
	/** The unique ID number of a record. You can't specify both a query and recordId key. */
	recordId?: number | string;
	/** The maximum number of records to return. */
	limit?: number;
	/** The number of records to skip before returning results. */
	offset?: number;
	/** An array of sort objects. */
	sort?: SortPart[];
	/** An array of portal names to include in the result. */
	portal?: string[];
	/** A JSON object that specifies record data to create or update. */
	fieldData?: Record<string, any>;
	/** The modification ID of a record for optimistic locking on updates. */
	modId?: string | number;
}

/** The raw top-level response from a FileMaker Data API script step. */
export interface DataAPIResponse {
	messages: { code: string; message: string }[];
	response: any;
}

/** A specialized array type that includes Data API metadata. */
export type DataAPIRecordArray = DataAPIRecord[] & {
	foundCount?: number;
	totalRecordCount?: number;
};

export interface DataAPIRecord extends Record<string, null | string | number | DataAPIRecord[]> {
	modId: number | string
	recordId: number | string
}

class FMPromiseError extends Error {
	public code?: string | number;

	constructor({message = 'Unknown error', code}: { message?: string; code?: string | number }) {
		super(message);
		this.name = 'FMPromiseError';
		this.code = code;
	}

	toString() {
		return this.code ? `${this.message} (${this.code})` : this.message;
	}
}

// --- Private Variables ---

let lastPromiseId = 0;
const callbacksById: { [key: number]: { resolve: (value: any) => void; reject: (reason?: any) => void } } = {};

const fmProxy: Promise<any> = Promise.race([
	new Promise<any>((resolve) => {
		// @ts-ignore
		if (window.FileMaker) {
			// @ts-ignore
			resolve(window.FileMaker);
		} else {
			let _fileMaker: any;
			Object.defineProperty(window, 'FileMaker', {
				get: () => _fileMaker,
				set: (v) => resolve(_fileMaker = v),
			});
		}
	}),
	new Promise((_, reject) =>
		setTimeout(() => reject(new FMPromiseError({message: 'FileMaker object not found within 5 seconds.'})), 5000)
	),
]);

// --- Main fmPromise Object ---

const fmPromise = {
	/** The name of the web viewer object in FileMaker. */
	get webViewerName() {
		return window.FMPROMISE_WEB_VIEWER_NAME || new URLSearchParams(window.location.search).get('webViewerName') || 'fmPromiseWebViewer';
	},
	/**
	 * Performs a FileMaker script and returns a Promise.
	 * @template T The expected type of the script result.
	 * @param {string} scriptName - The name of the FileMaker script to perform.
	 * @param {any} [scriptParameter=null] - The parameter to pass to the script. Non-string values will be JSON stringified.
	 * @param {PerformScriptOptions} [options={}] - Options for the script call.
	 * @returns {Promise<T>} A promise that resolves with the script result, or rejects with an FMPromiseError.
	 */
	async performScript<T = any>(scriptName: string, scriptParameter: any = null, options: PerformScriptOptions = {}): Promise<T> {
		const promiseId = ++lastPromiseId;
		console.log(`[fmPromise] #${promiseId}: Calling script "${scriptName}"`, scriptParameter);

		if (scriptParameter && typeof scriptParameter !== 'string') {
			scriptParameter = JSON.stringify(scriptParameter);
		}

		const fm = await fmProxy;

		let result = await new Promise((resolve, reject) => {
			callbacksById[promiseId] = {resolve, reject};
			const meta = JSON.stringify({
				scriptName, promiseId, webViewerName: this.webViewerName, ignoreResult: options?.ignoreResult || undefined
			});
			const comboParam = meta + '\n' + (scriptParameter || '');
			const option = options.runningScript || 0;

			if (option === 0) {
				fm.PerformScript('fmPromise', comboParam);
			} else {
				fm.PerformScriptWithOption('fmPromise', comboParam, option.toString());
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
		return result as T;
	},

	/**
	 * Evaluates an expression in FileMaker, optionally within the context of `Let` variables.
	 * @template T The expected type of the evaluated result.
	 * @param {string} expression - The calculation expression to evaluate.
	 * @param {Object<string, any>} [letVars={}] - Key-value pairs for a `Let()` function.
	 * @param {PerformScriptOptions} [options={}] - Options for the script call.
	 * @returns {Promise<T>} A promise that resolves with the evaluated result.
	 */
	evaluate<T = any>(expression: string, letVars: Record<string, any> = {}, options: PerformScriptOptions = {}): Promise<T> {
		const letEx = Object.entries(letVars || {}).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(';');
		const stmt = `Let([${letEx}] ; ${expression})`;
		return this.performScript('fmPromise.evaluate', stmt, options);
	},

	/**
	 * Executes a FileMaker Data API query.
	 * This method returns the raw, unprocessed result from the "Execute FileMaker Data API" script step.
	 * @param {DataAPIRequest} params - The Data API request parameters.
	 * @returns {Promise<DataAPIResponse>} A promise that resolves with the full Data API result object.
	 * @throws {FMPromiseError} If the Data API returns an error message.
	 */
	async executeFileMakerDataAPI(params: DataAPIRequest): Promise<DataAPIResponse> {
		const result = await this.performScript<DataAPIResponse>('fmPromise.executeFileMakerDataAPI', params);
		if (!result || !result.messages || !result.messages.length) {
			throw new FMPromiseError({code: -1, message: 'Empty data API response'});
		}
		if (result.messages[0].code !== '0') {
			throw new FMPromiseError(result.messages[0]);
		}
		return result;
	},

	/** @internal Processes a single portal row to clean up field names and hide metadata. */
	_processPortalRow(portalRow: any, portalName: string): any {
		const cleanedRow: { [key: string]: any } = {};
		const prefix = `${portalName}::`;

		for (const key in portalRow) {
			if (key === 'recordId' || key === 'modId') continue;

			if (key.startsWith(prefix)) {
				const newKey = key.substring(prefix.length);
				cleanedRow[newKey] = portalRow[key];
			} else {
				cleanedRow[key] = portalRow[key];
			}
		}

		Object.defineProperties(cleanedRow, {
			recordId: {value: portalRow.recordId, enumerable: false, writable: true, configurable: true},
			modId: {value: portalRow.modId, enumerable: false, writable: true, configurable: true},
		});
		return cleanedRow;
	},
	/**
	 * A convenience wrapper for `executeFileMakerDataAPI` that returns just the record data.
	 * @param params The Data API request parameters.
	 * @returns A promise resolving to an array of typed record objects, with metadata attached.
	 */
	async executeFileMakerDataAPIRecords(
		params: DataAPIRequest
	): Promise<DataAPIRecordArray> { // FIX: Simplified the return type generic.
		const response = await this.executeFileMakerDataAPI(params);

		// FIX: Handle non-record responses (e.g., from update/delete/create actions) gracefully.
		if (!response.response.data) {
			const emptyArr: any[] = [];
			Object.defineProperties(emptyArr, {
				foundCount: {value: 0, enumerable: false},
				totalRecordCount: {value: 0, enumerable: false},
			});
			return emptyArr as DataAPIRecordArray;
		}

		const arr = response.response.data.map((o: any) => {
			const portalData = o.portalData || {};
			const cleanedPortalData: { [key: string]: any } = {};

			// Process each portal to clean up its rows
			for (const portalName in portalData) {
				const portalRows = portalData[portalName];
				cleanedPortalData[portalName] = portalRows.map((row: any) => this._processPortalRow(row, portalName));
			}

			const rec = {...o.fieldData, ...cleanedPortalData};
			Object.defineProperties(rec, {
				recordId: {value: o.recordId, enumerable: false, writable: true, configurable: true},
				modId: {value: o.modId, enumerable: false, writable: true, configurable: true},
			});

			return rec;
		});

		Object.defineProperties(arr, {
			foundCount: {value: response.response.dataInfo.foundCount, enumerable: false},
			totalRecordCount: {value: response.response.dataInfo.totalRecordCount, enumerable: false},
		});

		return arr as DataAPIRecordArray;
	},

	/**
	 * Executes a SQL query using FileMaker's `ExecuteSQL` function.
	 * Can be called as a standard function or as a tagged template literal.
	 * @param {TemplateStringsArray | string} sqlOrStrings - The SQL query string or template literal strings.
	 * @param {...any} bindings - Values to bind to the `?` placeholders.
	 * @returns {Promise<string[][]>} A promise resolving to an array of rows, where each row is an array of strings.
	 */
	async executeSql(sqlOrStrings: TemplateStringsArray | string, ...bindings: any[]): Promise<string[][]> { // FIX: Changed return type to string[][]
		let sql: string;
		let finalBindings: any[];

		if (Array.isArray(sqlOrStrings) && Array.isArray((sqlOrStrings as TemplateStringsArray).raw)) {
			if (bindings.length !== sqlOrStrings.length - 1) {
				throw new FMPromiseError({code: -1, message: 'Invalid template literal for executeSql'});
			}
			sql = (sqlOrStrings as TemplateStringsArray).join('?').replace(/\n\s*/g, ' ');
			finalBindings = bindings;
		} else if (typeof sqlOrStrings === 'string') {
			sql = sqlOrStrings;
			finalBindings = bindings;
		} else {
			throw new FMPromiseError({
				code: -1,
				message: 'Invalid arguments: executeSql must be called with a SQL string, or as a template literal.'
			});
		}

		const p = finalBindings.map((o) => ` ; ${JSON.stringify(o)}`).join('');
		const colDelim = `|${Math.random()}|`;
		const rowDelim = `~${Math.random()}~`;

		const rawData = await this.evaluate<string>(`ExecuteSQLe(${JSON.stringify(sql)} ; "${colDelim}" ; "${rowDelim}"${p})`, undefined, {alwaysReturnString: true});

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
	 */
	insertFromUrl(url: string, curlOptions: string = ''): Promise<string> {
		return this.performScript('fmPromise.insertFromURL', {url, curlOptions});
	},

	/**
	 * Calls a FileMaker script to set a field's value by its fully qualified name.
	 * @param {string} fmFieldNameToSet - The name of the field (e.g., "MyTable::MyField").
	 * @param {any} value - The value to set.
	 * @returns {Promise<any>}
	 */
	setFieldByName(fmFieldNameToSet: string, value: any): Promise<any> {
		return this.performScript('fmPromise.setFieldByName', {fmFieldNameToSet, value});
	},

	/**
	 * Shows a custom dialog in FileMaker.
	 * @param {string} title - The dialog title.
	 * @param {string} body - The dialog message.
	 * @param {string} [btn1='OK'] - The label for the first button (default).
	 * @param {string} [btn2=''] - The label for the second button (optional).
	 * @param {string} [btn3=''] - The label for the third button (optional).
	 * @returns {Promise<number>} A promise resolving to the 1-based index of the button clicked.
	 */
	async showCustomDialog(title: string, body: string, btn1 = 'OK', btn2 = '', btn3 = ''): Promise<number> {
		const result = await this.performScript<string>('fmPromise.showCustomDialog', {title, body, btn1, btn2, btn3});
		return parseInt(result, 10) || 0; // Ensure it returns a number, defaulting to 0
	},

	/** @internal */
	_resolve(promiseId: number, result: any): void {
		if (callbacksById[promiseId]) {
			callbacksById[promiseId].resolve(result);
			delete callbacksById[promiseId];
		}
	},

	/** @internal */
	_reject(promiseId: number, errorString: string): void {
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
	},
};

// --- Global Exports ---

declare global {
	interface Window {
		fmPromise: typeof fmPromise;
		fmPromise_Resolve: (promiseId: number, result: any) => void;
		fmPromise_Reject: (promiseId: number, errorString: string) => void;
		FMPROMISE_WEB_VIEWER_NAME?: string;
	}
}

// @ts-ignore
globalThis.fmPromise = fmPromise;
// @ts-ignore
globalThis.fmPromise_Resolve = fmPromise._resolve;
// @ts-ignore
globalThis.fmPromise_Reject = fmPromise._reject;

export default fmPromise;
