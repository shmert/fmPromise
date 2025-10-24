// --- Type Definitions ---

import {
	DataAPICreateRequest,
	DataAPICreateResponse,
	DataAPIDeleteRequest,
	DataAPIDeleteResponse,
	DataAPIMetaDataRequest,
	DataAPIMetaDataResponse,
	DataAPIReadRequest,
	DataAPIReadResponse,
	DataAPIRecordArray,
	DataAPIRequest,
	DataAPIResponse,
	DataAPIUpdateRequest,
	DataAPIUpdateResponse
} from './types';

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

export class FMPromiseService {
	/** The name of the web viewer object in FileMaker. */
	get webViewerName() {
		return window.FMPROMISE_WEB_VIEWER_NAME || new URLSearchParams(window.location.search).get('webViewerName') || 'fmPromiseWebViewer';
	}

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
	}

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
	}

	/** Fetches records and returns the full Data API response object, which includes a `.toRecords()` helper. */
	async executeFileMakerDataAPI<T = Record<string, any>>(params: DataAPIReadRequest): Promise<DataAPIReadResponse<T>>;
	/** Creates a new record. */
	async executeFileMakerDataAPI(params: DataAPICreateRequest): Promise<DataAPICreateResponse>;
	/** Updates an existing record. */
	async executeFileMakerDataAPI(params: DataAPIUpdateRequest): Promise<DataAPIUpdateResponse>;
	/** Deletes an existing record. */
	async executeFileMakerDataAPI(params: DataAPIDeleteRequest): Promise<DataAPIDeleteResponse>;
	/** Fetches metadata about layouts or tables. */
	async executeFileMakerDataAPI(params: DataAPIMetaDataRequest): Promise<DataAPIMetaDataResponse>;

	// =================================================================
	// Single implementation for executeFileMakerDataAPI
	// This is the actual code that runs. Its signature must be compatible with all overloads.
	// =================================================================
	async executeFileMakerDataAPI<T = Record<string, any>>(params: DataAPIRequest): Promise<DataAPIResponse<T>> {
		const result = await this.performScript<any>('fmPromise.executeFileMakerDataAPI', params);

		if (!result || !result.messages || !result.messages.length) {
			throw new FMPromiseError({ code: -1, message: 'Empty data API response' });
		}
		if (result.messages[0].code !== '0') {
			throw new FMPromiseError(result.messages[0]);
		}

		if ((params.action === 'read' || !params.action)) {
			const readResponse = result as DataAPIReadResponse<T>;
			const self = this;

			readResponse.toRecords = function (): DataAPIRecordArray<T> {
				const responseData = this.response.data || [];

				const arr = responseData.map((record) => {
					const cleanedPortalData: { [key: string]: any[] } = {};
					for (const portalKey in record.portalData) {
						cleanedPortalData[portalKey] = record.portalData[portalKey];
					}

					return {
						...record.fieldData,
						...cleanedPortalData,
						recordId: record.recordId,
						modId: record.modId,
					};
				});

				const dataInfo = this.response.dataInfo || { totalRecordCount: 0 };
				Object.defineProperties(arr, {
					totalRecordCount: { value: dataInfo.totalRecordCount, enumerable: false },
				});
				return arr as DataAPIRecordArray<T>;
			};
			return readResponse;
		}

		return result;
	}

	/**
	 * A convenience method which calls `fmPromise.executeFileMakerDataAPI({ action: 'read', ... })` and the `.toRecords()` method on the response.
	 */
	async executeFileMakerDataAPIRecords<T>(params: DataAPIReadRequest): Promise<DataAPIRecordArray<T>> {
		if (params.action && params.action !== 'read') {
			throw new FMPromiseError({message: 'executeFileMakerDataAPIRecords only supports the \'read\' action.'});
		}
		const response = await this.executeFileMakerDataAPI<T>(params);
		return response.toRecords();
	}

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
	}

	/**
	 * Calls a FileMaker script to perform an "Insert from URL" script step.
	 * @param {string} url - The URL to fetch/post to.
	 * @param {string} [curlOptions=''] - cURL options for the request.
	 * @returns {Promise<string>} The response body.
	 */
	insertFromUrl(url: string, curlOptions: string = ''): Promise<string> {
		return this.performScript('fmPromise.insertFromURL', {url, curlOptions});
	}

	/**
	 * Calls a FileMaker script to set a field's value by its fully qualified name.
	 * @param {string} fmFieldNameToSet - The name of the field (e.g., "MyTable::MyField").
	 * @param {any} value - The value to set.
	 * @returns {Promise<any>}
	 */
	setFieldByName(fmFieldNameToSet: string, value: any): Promise<any> {
		return this.performScript('fmPromise.setFieldByName', {fmFieldNameToSet, value});
	}

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
	}

	/** @internal */
	private _resolve(promiseId: number, result: any): void {
		if (callbacksById[promiseId]) {
			callbacksById[promiseId].resolve(result);
			delete callbacksById[promiseId];
		}
	}

	/** @internal */
	private _reject(promiseId: number, errorString: string): void {
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

// --- Global Exports ---

declare global {
	interface Window {
		fmPromise: typeof FMPromiseService;
		fmPromise_Resolve: (promiseId: number, result: any) => void;
		fmPromise_Reject: (promiseId: number, errorString: string) => void;
		FMPROMISE_WEB_VIEWER_NAME?: string;
	}
}

const fmPromise = new FMPromiseService();

// @ts-ignore
globalThis.fmPromise = fmPromise;
// @ts-ignore
globalThis.fmPromise_Resolve = fmPromise._resolve;
// @ts-ignore
globalThis.fmPromise_Reject = fmPromise._reject;

export default fmPromise;
