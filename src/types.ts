// types.ts

// =================================================================
// BASE TYPES
// =================================================================

/** A generic Data API message object. */
interface DataAPIMessage {
	code: string;
	message: string;
}

/** The base structure for all Data API responses. */
interface BaseDataAPIResponse {
	messages: DataAPIMessage[];
}

/** The base structure for most Data API requests. */
interface BaseDataAPIRequest {
	layouts: string;
	version?: 'v1' | 'v2' | 'vLatest';
}

// =================================================================
// RECORD & HELPERS
// =================================================================

/**
 * Represents a single FileMaker record object after processing.
 * It combines your data type `T` with readonly `recordId` and `modId`.
 */
export type DataAPIRecord<T> = T & {
	readonly recordId: string;
	readonly modId: string;
};

/**
 * Represents the special array returned by `toRecords()`.
 * It's a standard array of records but with added readonly properties for counts.
 */
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

interface DataAPIReadRequestBase extends BaseDataAPIRequest {
	action: 'read';
	limit?: number;
	offset?: number;
	sort?: SortObject[];
	/**
	 * the object ids of portals to fetch. Default is to fetch all.<br>
	 * <strong>Note:</strong> if a portal has an objectId, the `toRecords()` function will use that as the key for the portal data.
	 */
	portal?: string[];
}

// You can either query or specify a single recordId
type DataAPIReadRequestQuery = { query: any[] };
type DataAPIReadRequestRecordId = { recordId: number | string };

export type DataAPIReadRequest = DataAPIReadRequestBase & (DataAPIReadRequestQuery | DataAPIReadRequestRecordId);

export interface DataAPIReadResponse<T> extends BaseDataAPIResponse {
	response: {
		dataInfo?: {
			database: string;
			layout: string;
			table: string;
			totalRecordCount: number;
			foundCount: number;
			returnedCount: number;
		};
		data?: Array<{
			fieldData: T;
			portalData: Record<string, any[]>;
			recordId: string;
			modId: string;
		}>;
	};
	/**
	 * A helper function to transform the raw response data into a clean,
	 * strongly-typed array of records.
	 * @returns {DataAPIRecordArray<T>} An array of record objects, enhanced with metadata.
	 */
	toRecords: () => DataAPIRecordArray<T>;
}


// =================================================================
// ACTION: "create"
// =================================================================
export interface DataAPICreateRequest extends BaseDataAPIRequest {
	action: 'create';
	fieldData: Record<string, any>;
}

export interface DataAPICreateResponse extends BaseDataAPIResponse {
	response: {
		recordId: string;
		modId: string;
	};
}

// =================================================================
// ACTION: "update"
// =================================================================
export interface DataAPIUpdateRequest extends BaseDataAPIRequest {
	action: 'update';
	recordId: number | string;
	modId?: number | string;
	fieldData: Record<string, any>;
}

export interface DataAPIUpdateResponse extends BaseDataAPIResponse {
	response: {
		modId: string;
	};
}


// =================================================================
// ACTION: "delete"
// =================================================================
export interface DataAPIDeleteRequest extends BaseDataAPIRequest {
	action: 'delete';
	recordId: number | string;
	modId?: number | string;
}

export interface DataAPIDeleteResponse extends BaseDataAPIResponse {
	response: {}; // Empty response object
}


// =================================================================
// ACTION: "metaData"
// =================================================================
type MetaDataRequestAllLayouts = { layouts: '' };
type MetaDataRequestOneLayout = { layouts: string };
type MetaDataRequestOneTable = { tables: string };

export type DataAPIMetaDataRequest = {
	action: 'metaData';
	version?: 'v1' | 'v2' | 'vLatest';
} & (MetaDataRequestAllLayouts | MetaDataRequestOneLayout | MetaDataRequestOneTable);


export interface DataAPIMetaDataResponse extends BaseDataAPIResponse {
	response: Record<string, any>; // The metadata response is complex, using a general object for simplicity
}

// =================================================================
// UNION TYPES
// =================================================================

/** A union of all possible Data API request types. */
export type DataAPIRequest =
	| DataAPIReadRequest
	| DataAPICreateRequest
	| DataAPIUpdateRequest
	| DataAPIDeleteRequest
	| DataAPIMetaDataRequest;

/** A union of all possible Data API response types. */
export type DataAPIResponse<T> =
	| DataAPIReadResponse<T>
	| DataAPICreateResponse
	| DataAPIUpdateResponse
	| DataAPIDeleteResponse
	| DataAPIMetaDataResponse;
