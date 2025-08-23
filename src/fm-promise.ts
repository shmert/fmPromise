// By defining an empty LayoutMap, the code works even if no schema is generated.
// The user's generated `filemaker-types.d.ts` will merge with and extend this.
declare namespace FMSchema {
	interface LayoutMap {
	}
}

export type FMPromiseScriptRunningOption = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Options for the `performScript` call, mirroring FileMaker's `Perform Script with Option`.
 */
export interface PerformScriptOptions {
	/** If true, the promise will always resolve with a string, bypassing automatic JSON parsing. */
	alwaysReturnString?: boolean;
	/**
	 * Specifies how to handle a currently running FileMaker script.
	 * 0: Continue (default); 1: Halt; 2: Exit; 3: Resume; 4: Pause; 5: Interrupt.
	 * @see {@link https://help.claris.com/en/pro-help/content/filemaker-performscriptwithoption.html|FileMaker Docs}
	 */
	runningScript?: FMPromiseScriptRunningOption;
}

/**
 * Parameters for a FileMaker Data API request.
 */
export interface DataAPIRequest {
	/** The name of the layout to perform the action on. */
	layouts: keyof FMSchema.LayoutMap | (string & {}); // Allow any string but autocomplete known layouts
	/** An array of find request objects. */
	query?: any[];
	/** The maximum number of records to return. */
	limit?: number;
	/** The number of records to skip before returning results. */
	offset?: number;
	/** An array of sort objects. */
	sort?: any[];
	/** An array of portal names to include in the result. */
	portal?: string[];
}

/**
 * The raw top-level response from a FileMaker Data API script step.
 */
export interface DataAPIResponse {
	messages: { code: string; message: string }[];
	response: any;
}


class FMPromiseError extends Error {
	public code?: string | number;

	constructor({message = 'Unknown error', code}: { message?: string; code?: string | number }) {
		super(message);
		this.name = 'FMPromiseError';
		this.code = code;
	}
}

// --- Private Variables ---

let lastPromiseId = 0;
const callbacksById: { [key: number]: { resolve: (value: any) => void; reject: (reason?: any) => void } } = {};

const fmProxy: Promise<any> = Promise.race([
	new Promise<any>((resolve) => {
		// @ts-ignore
		if (window.FileMaker) resolve(window.FileMaker);
		else Object.defineProperty(window, 'FileMaker', {set: (v) => resolve(v)});
	}),
	new Promise((_, reject) =>
		setTimeout(() => reject(new FMPromiseError({message: 'FileMaker object not found within 5 seconds.'})), 5000)
	),
]);

// --- Main fmPromise Object ---

const fmPromise = {
	webViewerName: new URLSearchParams(window.location.search).get('webViewerName') || 'fmPromiseWebViewer',

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

		if (scriptParameter && typeof scriptParameter !== 'string') {
			scriptParameter = JSON.stringify(scriptParameter);
		}

		const fm = await fmProxy;

		let result = await new Promise((resolve, reject) => {
			callbacksById[promiseId] = {resolve, reject};
			const meta = JSON.stringify({scriptName, promiseId, webViewerName: this.webViewerName});
			const comboParam = meta + '\n' + (scriptParameter || '');
			const option = (options.runningScript || 0).toString();

			fm.PerformScriptWithOption('fmPromise', comboParam, option);
		});

		if (!options.alwaysReturnString && typeof result === 'string' && (result.startsWith('{') || result.startsWith('['))) {
			try {
				result = JSON.parse(result);
			} catch (e) { /* Ignore parsing errors */
			}
		}
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
		const letEx = Object.entries(letVars).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(';');
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
		if (result?.messages?.[0]?.code !== '0') {
			throw new FMPromiseError(result.messages[0]);
		}
		return result;
	},

	/**
	 * A convenience wrapper for `executeFileMakerDataAPI` that returns just the record data,
	 * with full TypeScript type safety based on the provided layout name.
	 * @template L The name of the layout, which must be a key in the generated `FMSchema.LayoutMap`.
	 * @param params The Data API request parameters. The `layouts` property is strongly typed.
	 * @returns A promise resolving to an array of typed record objects.
	 */
	async executeFileMakerDataAPIRecords<L extends keyof FMSchema.LayoutMap>(
		params: { layouts: L } & Omit<DataAPIRequest, 'layouts'>
	): Promise<FMSchema.LayoutMap[L][]> {
		const rawResponse = await this.executeFileMakerDataAPI(params);

		const arr = rawResponse.response.data.map((o: any) => {
			const rec = {...o.fieldData, ...o.portalData};
			Object.defineProperties(rec, {
				recordId: {value: o.recordId, enumerable: false},
				modId: {value: o.modId, enumerable: false},
			});
			return rec;
		});
		return arr;
	},

	/**
	 * Executes a SQL query using FileMaker's `ExecuteSQL` function.
	 * Can be called as a standard function or as a tagged template literal.
	 * @param {TemplateStringsArray | string} sqlOrStrings - The SQL query string or template literal strings.
	 * @param {...any} bindings - Values to bind to the `?` placeholders.
	 * @returns {Promise<any[][]>} A promise resolving to an array of rows.
	 */
	async executeSql(sqlOrStrings: TemplateStringsArray | string, ...bindings: any[]): Promise<any[][]> {
		let sql: string;
		if (Array.isArray(sqlOrStrings) && 'raw' in sqlOrStrings) {
			sql = sqlOrStrings.map((str, i) => str + (bindings.length > i ? '?' : '')).join('');
		} else {
			sql = sqlOrStrings as string;
		}

		const p = bindings.map((o) => ` ; ${JSON.stringify(o)}`).join('');
		const colDelim = `|${Math.random()}|`;
		const rowDelim = `~${Math.random()}~`;

		const rawData = await this.evaluate<string>(`ExecuteSQLe(${JSON.stringify(sql)} ; "${colDelim}" ; "${rowDelim}"${p})`, undefined, {alwaysReturnString: true});

		if (!rawData) return [];
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
		return parseInt(result, 10);
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
				errorObj = {message: errorString, code: -1};
			}
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
	}
}

// For debugging in the browser inspector
// @ts-ignore
globalThis.fmPromise = fmPromise;

// For WebDirect compatibility
// @ts-ignore
globalThis.fmPromise_Resolve = fmPromise._resolve;
// @ts-ignore
globalThis.fmPromise_Reject = fmPromise._reject;

export default fmPromise;
