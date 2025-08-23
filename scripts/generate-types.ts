import {XMLParser} from 'fast-xml-parser';
import fs from 'fs/promises';
import path from 'path';

// --- TYPE DEFINITIONS - Directly derived from the provided XSD ---
interface FmTableDef {
	'@_id': string;
	'@_name': string;
}

interface FmFieldDef {
	'@_name': string;
	'@_dataType'?: string;
	'@_datatype'?: string;
	'@_comment'?: string;
}

interface FmFieldCatalog {
	BaseTableReference: { '@_id': string };
	ObjectList?: { Field: FmFieldDef | FmFieldDef[] };
}

interface FmFieldReference {
	'@_name': string;
	TableOccurrenceReference: { '@_name': string; };
}

interface FmPortal {
	TableOccurrenceReference: { '@_name': string; };
	ObjectList?: { LayoutObject: FmLayoutObject | FmLayoutObject[] };
}

interface FmLayoutObject {
	'@_type': string;
	Portal?: FmPortal;
	Field?: { FieldReference: FmFieldReference };
	ObjectList?: { LayoutObject: FmLayoutObject | FmLayoutObject[] };
}

interface FmLayoutPart {
	ObjectList?: { LayoutObject: FmLayoutObject | FmLayoutObject[] };
}

interface FmLayout {
	'@_name': string;
	'@_isFolder'?: string;
	PartsList?: { Part: FmLayoutPart | FmLayoutPart[] };
}

interface FmXml {
	FMSaveAsXML: {
		Structure: {
			AddAction: {
				BaseTableCatalog: { BaseTable: FmTableDef | FmTableDef[] };
				FieldsForTables: { FieldCatalog: FmFieldCatalog[] };
				LayoutCatalog: { Layout: FmLayout | FmLayout[] }
			}
		}
	}
}

// --- HELPER FUNCTIONS ---
const mapFmTypeToTsType = (fmType: string | undefined): string => {
	switch (fmType) {
		case 'Number':
			return 'number';
		case 'Text':
		case 'Date':
		case 'Time':
		case 'Timestamp':
		case 'Container':
			return 'string';
		default:
			return 'any';
	}
};
const normalizeToArray = <T>(data: T | T[] | undefined): T[] => !data ? [] : Array.isArray(data) ? data : [data];

interface ExtractedLayoutInfo {
	fields: { toName: string; fieldName: string }[];
	portals: { portalToName: string; fields: { toName: string; fieldName: string }[] }[];
}

/** Recursively find all fields and portals within a list of layout objects. */
function findFieldsAndPortals(objects: FmLayoutObject[]): ExtractedLayoutInfo {
	const result: ExtractedLayoutInfo = {fields: [], portals: []};
	for (const obj of objects) {
		if (obj.Field?.FieldReference) {
			const ref = obj.Field.FieldReference;
			result.fields.push({toName: ref.TableOccurrenceReference['@_name'], fieldName: ref['@_name']});
		} else if (obj['@_type'] === 'Portal' && obj.Portal) {
			const portalFields = findFieldsAndPortals(normalizeToArray(obj.Portal.ObjectList?.LayoutObject));
			result.portals.push({portalToName: obj.Portal.TableOccurrenceReference['@_name'], fields: portalFields.fields});
		} else if (obj.ObjectList) {
			const nested = findFieldsAndPortals(normalizeToArray(obj.ObjectList.LayoutObject));
			result.fields.push(...nested.fields);
			result.portals.push(...nested.portals);
		}
	}
	return result;
}

// --- CORE LOGIC ---
export async function generateTypesFromXml(xmlFilePath: string, outputDir: string): Promise<void> {
	console.log(`[Generator] Reading schema from: ${path.basename(xmlFilePath)}`);
	let xmlContent = await fs.readFile(xmlFilePath, 'utf-16le');
	xmlContent = xmlContent.replace(/^\uFEFF/, '');

	const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: '@_', ignoreDeclaration: true, parseTagValue: false});
	const jsonObj = parser.parse(xmlContent) as FmXml;

	const tableDefs = normalizeToArray(jsonObj.FMSaveAsXML?.Structure?.AddAction?.BaseTableCatalog?.BaseTable);
	const fieldCatalogs = normalizeToArray(jsonObj.FMSaveAsXML?.Structure?.AddAction?.FieldsForTables?.FieldCatalog);
	let layouts = normalizeToArray(jsonObj.FMSaveAsXML?.Structure?.AddAction?.LayoutCatalog?.Layout);

	if (tableDefs.length === 0) throw new Error('Could not find BaseTableCatalog in the XML file.');
	if (fieldCatalogs.length === 0) throw new Error('Could not find FieldsForTables in the XML file.');
	if (layouts.length === 0) throw new Error('Could not find LayoutCatalog in the XML file.');

	const namespace = path.basename(xmlFilePath, '.xml').replace(/[^a-zA-Z0-9_]/g, '');

	// --- Pass 1: Build a comprehensive schema map ---
	const tableIdToName = new Map(tableDefs.map(t => [t['@_id'], t['@_name']]));
	const schemaMap = new Map<string, Map<string, string>>();
	tableDefs.forEach(t => schemaMap.set(t['@_name'], new Map()));

	fieldCatalogs.forEach(catalog => {
		const parentTableId = catalog.BaseTableReference['@_id'];
		const parentTableName = tableIdToName.get(parentTableId);
		if (parentTableName) {
			normalizeToArray(catalog.ObjectList?.Field).forEach(field => {
				const dataType = field['@_dataType'] || field['@_datatype'];
				schemaMap.get(parentTableName)?.set(field['@_name'], mapFmTypeToTsType(dataType));
			});
		}
	});

	// --- Pass 2: Filter layouts and generate high-fidelity, flat interfaces ---
	const seenLayoutNames = new Set<string>();
	layouts = layouts.filter(layout => {
		const name = layout['@_name'];
		if (!name || name === '--' || layout['@_isFolder'] === 'True' || layout['@_isFolder'] === 'Marker' || seenLayoutNames.has(name)) return false;
		seenLayoutNames.add(name);
		return true;
	});

	const layoutInterfaces: string[] = [];
	const portalRowInterfaces = new Map<string, string>();

	layouts.forEach(layout => {
		const layoutName = layout['@_name'];
		const safeLayoutName = layoutName.replace(/[^a-zA-Z0-9_]/g, '_');
		const allLayoutObjects = normalizeToArray(layout.PartsList?.Part)
			.flatMap(part => normalizeToArray(part.ObjectList?.LayoutObject));

		const {fields: baseFields, portals} = findFieldsAndPortals(allLayoutObjects);

		const fieldProps = baseFields.map(f => `        "${f.fieldName}": ${schemaMap.get(f.toName)?.get(f.fieldName) || 'any'};`);
		const portalProps: string[] = [];

		portals.forEach(portal => {
			const portalToName = portal.portalToName;
			const portalRowInterfaceName = `${safeLayoutName}_${portalToName}_PortalRow`;
			portalProps.push(`        "${portalToName}": ${portalRowInterfaceName}[];`);

			if (!portalRowInterfaces.has(portalRowInterfaceName)) {
				const portalFieldProps = portal.fields.map(f => `    "${f.toName}::${f.fieldName}": ${schemaMap.get(f.toName)?.get(f.fieldName) || 'any'};`);
				portalRowInterfaces.set(portalRowInterfaceName, `    interface ${portalRowInterfaceName} {\n${[...new Set(portalFieldProps)].join('\n')}\n    }`);
			}
		});

		const allProperties = [...new Set([...fieldProps, ...portalProps])];
		const mainLayoutInterface = `    interface ${safeLayoutName} {\n${allProperties.join('\n')}\n    }`;

		layoutInterfaces.push(mainLayoutInterface);
	});

	// --- Final Assembly ---
	const layoutMapStrings = layouts.map(layout => {
		const safeLayoutName = layout['@_name'].replace(/[^a-zA-Z0-9_]/g, '_');
		return `        "${layout['@_name']}": ${safeLayoutName};`;
	}).join('\n');

	const outputContent = `// Auto-generated by fm-promise-server. Do not edit manually.
// Last generated: ${new Date().toISOString()}

declare namespace ${namespace} {
// --- Portal Row Interfaces ---
${[...portalRowInterfaces.values()].join('\n\n')}

// --- Layout Interfaces ---
${layoutInterfaces.join('\n\n')}

    interface LayoutMap {
${layoutMapStrings}
    }
}
`;

	const outputPath = path.join(outputDir, 'filemaker-types.d.ts');
	await fs.writeFile(outputPath, outputContent);
	console.log(`[Generator] TypeScript definitions written to: ${outputPath}`);
}
