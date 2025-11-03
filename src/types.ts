// types.ts

/**
 * Note: The interfaces in this file are intentionally written in a verbose, flat manner
 * without using `extends` or complex intersections. This significantly improves the
 * autocompletion and type-hinting performance in modern IDEs like IntelliJ and VS Code.
 */

// =================================================================
// BASE TYPES (Referenced by the flat interfaces below)
// =================================================================

interface DataAPIMessage {
	code: string;
	message: string;
}

// =================================================================
// RECORD & HELPERS (Unchanged)
// =================================================================

export type DataAPIRecord<T> = T & {
	recordId: string;
	modId: string;
};

export interface DataAPIRecordArray<T> extends Array<DataAPIRecord<T>> {
	readonly foundCount: number;
	readonly totalRecordCount: number;
}


// =================================================================
// ACTION: "read" (Find Records)
// =================================================================

type SortObject = {
	fieldName: string;
	sortOrder: 'ascend' | 'descend';
};

/** The raw structure of a single portal record from the Data API. */
export type PortalRowData = Record<string, string | number> & {
	recordId: string;
	modId: string;
};

/** Metadata for a single portal from the `portalDataInfo` array. */
export interface PortalDataInfo {
	portalObjectName?: string;
	database: string;
	table: string;
	foundCount: number;
	returnedCount: number;
}

/** The raw structure of a single record from the Data API `data` array. */
interface RawDataAPIRecord<T> {
	fieldData: T;
	portalData: Record<string, PortalRowData[]>;
	recordId: string;
	modId: string;
	portalDataInfo?: PortalDataInfo[];
}

/** A find request performed using a query object. */
export interface DataAPIReadByQueryRequest {
	action: 'read';
	layouts: string;
	query: any[];
	limit?: number;
	offset?: number;
	sort?: SortObject[];
	portal?: string[];
	version?: 'v1' | 'v2' | 'vLatest';
}

/** A find request performed using a specific record ID. */
export interface DataAPIReadByRecordIdRequest {
	action: 'read';
	layouts: string;
	recordId: number | string;
	limit?: number;
	offset?: number;
	sort?: SortObject[];
	portal?: string[];
	version?: 'v1' | 'v2' | 'vLatest';
}

// This simple union of two flat interfaces is much easier for IDEs to parse.
export type DataAPIReadRequest = DataAPIReadByQueryRequest | DataAPIReadByRecordIdRequest;

export interface DataAPIReadResponse<T> {
	messages: DataAPIMessage[];
	response: {
		dataInfo?: {
			database: string;
			layout: string;
			table: string;
			totalRecordCount: number;
			foundCount: number;
			returnedCount: number;
		};
		data?: Array<RawDataAPIRecord<T>>;
	};
	toRecords: () => DataAPIRecordArray<T>;
}


// =================================================================
// ACTION: "create"
// =================================================================
export interface DataAPICreateRequest {
	action: 'create';
	layouts: string;
	fieldData: Record<string, any>;
	version?: 'v1' | 'v2' | 'vLatest';
}

export interface DataAPICreateResponse {
	messages: DataAPIMessage[];
	response: {
		recordId: string;
		modId: string;
	};
}


// =================================================================
// ACTION: "update"
// =================================================================
export interface DataAPIUpdateRequest {
	action: 'update';
	layouts: string;
	recordId: number | string;
	modId?: number | string;
	fieldData?: Record<string, any>;
	portalData?: Record<string, Array<{ recordId: number | string; [key: string]: any; }>>;
	version?: 'v1' | 'v2' | 'vLatest';
}

export interface DataAPIUpdateResponse {
	messages: DataAPIMessage[];
	response: {
		modId: string;
	};
}


// =================================================================
// ACTION: "delete"
// =================================================================
export interface DataAPIDeleteRequest {
	action: 'delete';
	layouts: string;
	recordId: number | string;
	modId?: number | string;
	version?: 'v1' | 'v2' | 'vLatest';
}

export interface DataAPIDeleteResponse {
	messages: DataAPIMessage[];
	response: {}; // Empty response object
}


// =================================================================
// ACTION: "metaData"
// =================================================================

/** A metadata request for one or more layouts. */
export interface DataAPIMetaDataByLayoutRequest {
	action: 'metaData';
	layouts: string; // Can be an empty string to request all layouts
	version?: 'v1' | 'v2' | 'vLatest';
}

/** A metadata request for a specific base table. */
export interface DataAPIMetaDataByTableRequest {
	action: 'metaData';
	tables: string;
	version?: 'v1' | 'v2' | 'vLatest';
}

// A simple union of two flat, mutually exclusive interfaces.
export type DataAPIMetaDataRequest = DataAPIMetaDataByLayoutRequest | DataAPIMetaDataByTableRequest;

export interface DataAPIMetaDataResponse {
	messages: DataAPIMessage[];
	response: Record<string, any>;
}

// =================================================================
// UNION TYPES (Unchanged)
// =================================================================

export type DataAPIRequest =
	| DataAPIReadRequest
	| DataAPICreateRequest
	| DataAPIUpdateRequest
	| DataAPIDeleteRequest
	| DataAPIMetaDataRequest;

export type DataAPIResponse<T> =
	| DataAPIReadResponse<T>
	| DataAPICreateResponse
	| DataAPIUpdateResponse
	| DataAPIDeleteResponse
	| DataAPIMetaDataResponse;
