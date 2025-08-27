import {XMLParser} from 'fast-xml-parser';
import fs from 'fs/promises';
import path from 'path';

// --- TYPE DEFINITIONS - Directly derived from the provided XSD ---
interface FmTableDef {
	'@_id': string;
	'@_name': string;
}

interface FmTheme {
	'@_Display': string;
	'@_name': string;
	UUID: { '#text': string };
	CSS: string;
	// Add other attributes if needed
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
				LayoutCatalog: { Layout: FmLayout | FmLayout[] };
				// NEW: Add ThemeCatalog definition
				ThemeCatalog?: { Theme: FmTheme | FmTheme[] };
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

	// --- Data Extraction and Schema Mapping (unchanged) ---
	const tableDefs = normalizeToArray(jsonObj.FMSaveAsXML?.Structure?.AddAction?.BaseTableCatalog?.BaseTable);
	const fieldCatalogs = normalizeToArray(jsonObj.FMSaveAsXML?.Structure?.AddAction?.FieldsForTables?.FieldCatalog);
	let layouts = normalizeToArray(jsonObj.FMSaveAsXML?.Structure?.AddAction?.LayoutCatalog?.Layout);
	if (tableDefs.length === 0 || fieldCatalogs.length === 0 || layouts.length === 0) throw new Error('Could not find required catalogs in XML.');
	const namespace = path.basename(xmlFilePath, '.xml').replace(/[^a-zA-Z0-9_]/g, '');
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

	// --- Layout Filtering (unchanged) ---
	const seenLayoutNames = new Set<string>();
	layouts = layouts.filter(layout => {
		const name = layout['@_name'];
		if (!name || name === '--' || layout['@_isFolder'] === 'True' || layout['@_isFolder'] === 'Marker' || seenLayoutNames.has(name)) return false;
		seenLayoutNames.add(name);
		return true;
	});

	// --- Pass 2: Generate high-fidelity FLAT interfaces for each layout ---
	const layoutInterfaces: string[] = [];
	const portalRowInterfaces = new Map<string, string>();

	layouts.forEach(layout => {
		const layoutName = layout['@_name'];
		const safeLayoutName = layoutName.replace(/[^a-zA-Z0-9_]/g, '_');
		const allLayoutObjects = normalizeToArray(layout.PartsList?.Part).flatMap(part => normalizeToArray(part.ObjectList?.LayoutObject));
		const {fields: baseFields, portals} = findFieldsAndPortals(allLayoutObjects);

		const fieldProps = baseFields.map(f => `        "${f.fieldName}": ${schemaMap.get(f.toName)?.get(f.fieldName) || 'any'};`);
		const portalProps: string[] = [];

		portals.forEach(portal => {
			const portalToName = portal.portalToName;
			const portalRowInterfaceName = `${safeLayoutName}_${portalToName}_PortalRow`;
			portalProps.push(`        "${portalToName}": ${portalRowInterfaceName}[];`);

			if (!portalRowInterfaces.has(portalRowInterfaceName)) {
				const portalFieldProps = portal.fields.map(f => {
					const fieldType = schemaMap.get(f.toName)?.get(f.fieldName) || 'any';
					const fieldKey = f.toName === portalToName ? f.fieldName : `${f.toName}::${f.fieldName}`;
					return `    "${fieldKey}": ${fieldType};`;
				});
				// Append 'extends DataAPIRecord' to the portal row interface
				portalRowInterfaces.set(portalRowInterfaceName, `    interface ${portalRowInterfaceName} extends DataAPIRecord {\n${[...new Set(portalFieldProps)].join('\n')}\n    }`);
			}
		});

		const allProperties = [...new Set([...fieldProps, ...portalProps])];
		// Append 'extends DataAPIRecord' to the main layout interface
		const mainLayoutInterface = `    interface ${safeLayoutName} extends DataAPIRecord {\n${allProperties.join('\n')}\n    }`;

		layoutInterfaces.push(mainLayoutInterface);
	});

	// --- Final Assembly ---
	const layoutMapStrings = layouts.map(layout => {
		const safeLayoutName = layout['@_name'].replace(/[^a-zA-Z0-9_]/g, '_');
		return `        "${layout['@_name']}": ${safeLayoutName};`;
	}).join('\n');

	// Add the DataAPIRecord interface definition to the top of the output.
	const outputContent = `// Auto-generated by fm-promise-server. Do not edit manually.
// Last generated: ${new Date().toISOString()}

declare namespace ${namespace} {

    interface DataAPIRecord {
        recordId: string;
        modId: string;
    }

// --- Portal Row Interfaces ---
${[...portalRowInterfaces.values()].join('\n\n')}

// --- Layout Interfaces ---
${layoutInterfaces.join('\n\n')}

    interface LayoutMap {
${layoutMapStrings}
    }
}
`;

	const generatedDir = path.join(outputDir, 'src', 'fm-promise', namespace);
	const outputPath = path.join(generatedDir, 'types.d.ts');

	// Ensure the nested directory exists before writing the file.
	await fs.mkdir(generatedDir, {recursive: true});
	await fs.writeFile(outputPath, outputContent);

	await generateCssFromThemes(jsonObj, outputDir, namespace);

	console.log(`[Generator] TypeScript definitions written to: ${outputPath}`);
}

/**
 * Parses the Theme information from the XML and generates a web-compatible CSS file.
 */
/**
 * Parses the Theme information from the XML and generates web-compatible CSS files for each theme.
 */
async function generateCssFromThemes(jsonObj: FmXml, outputDir: string, namespace: string) {
	console.log('[Generator] Starting CSS generation from FileMaker themes...');

	const themes = normalizeToArray(jsonObj.FMSaveAsXML?.Structure?.AddAction?.ThemeCatalog?.Theme);

	if (!themes || themes.length === 0) {
		console.log('[Generator] No themes found in XML. Skipping CSS generation.');
		return;
	}

	for (const theme of themes) {
		const themeDisplayName = theme['@_Display'];
		const themeCss = theme.CSS;
		const themeFmName = theme['@_name'];
		const themeUuid = theme.UUID?.['#text'];

		if (!themeDisplayName || !themeCss) {
			console.warn(`[Generator] Skipping a theme due to missing Display Name or CSS content.`);
			continue;
		}

		const safeFileName = themeDisplayName.toLowerCase().replace(/[^a-z0-9_]+/g, '-') + '.css';
		console.log(`[Generator] Processing theme "${themeDisplayName}" -> ${safeFileName}`);

		const headerComment = `/*
 * FileMaker Theme: ${themeDisplayName}
 * Auto-generated by fm-promise-server. Do not edit manually.
 * 
 * FM Name: ${themeFmName}
 * FM UUID: ${themeUuid}
 * Generated: ${new Date().toISOString()}
 */\n\n`;

		const ruleRegex = /([^{]+)\s*{([^}]+)}/g;
		let match;
		const cssRules: string[] = [];
		const propertyGroups = new Map<string, Record<string, string>>();

		while ((match = ruleRegex.exec(themeCss)) !== null) {
			const fmSelector = match[1].trim();
			const fmProperties = match[2].trim();
			const webSelector = translateSelector(fmSelector);

			if (!webSelector) continue; // Skip selectors we don't map

			if (!propertyGroups.has(webSelector)) {
				propertyGroups.set(webSelector, {});
			}
			const group = propertyGroups.get(webSelector)!;

			fmProperties.split(';').forEach(prop => {
				const parts = prop.split(':');
				if (parts.length < 2) return;
				const key = parts[0].trim();
				const value = parts.slice(1).join(':').trim();
				group[key] = value;
			});
		}

		for (const [selector, properties] of propertyGroups.entries()) {
			const translatedProps = translateProperties(properties);
			if (Object.keys(translatedProps).length > 0) {
				const propsString = Object.entries(translatedProps)
					.map(([key, value]) => `  ${key}: ${value};`)
					.join('\n');
				cssRules.push(`${selector} {\n${propsString}\n}`);
			}
		}

		const outputContent = headerComment + cssRules.join('\n\n');
		const generatedDir = path.join(outputDir, 'src', 'fm-promise', namespace);
		const outputPath = path.join(generatedDir, safeFileName);
		await fs.mkdir(generatedDir, { recursive: true });
		await fs.writeFile(outputPath, outputContent);
		console.log(`[Generator] ✔ Successfully wrote CSS for theme "${themeDisplayName}" to: ${outputPath}`);
	}
}


function translateSelector(fmSelector: string): string | null {
	// Strip trailing sub-selectors like .self, .text, .inner_border
	const cleanSelector = fmSelector.replace(/\s+\.[\w_]+$/, '');

	const fmObjectMap: Record<string, string> = {
		'edit_box': 'input.fm-edit-box, input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="tel"]',
		'text_area': 'textarea.fm-text-area',
		'drop_down': 'select.fm-drop-down',
		'button': 'button.fm-button, .btn',
		'text_box': '.fm-text',
	};

	const match = cleanSelector.match(/([\w_]+)(?:\.([\w_]+))?:(\w+)/);
	if (!match) return null;

	const [, fmObject, fmClass, fmState] = match;

	if (!fmObjectMap[fmObject]) return null;

	let baseSelector = fmClass ? `.${fmClass}` : fmObjectMap[fmObject];
	if (fmObject === 'button' && fmClass) {
		baseSelector = `button.${fmClass}, .btn.${fmClass}`;
	}

	const stateMap: Record<string, string> = {
		'hover': ':hover',
		'pressed': ':active',
		'focus': ':focus',
		'normal': '',
		'placeholder': '::placeholder',
	};

	const webState = stateMap[fmState] ?? '';

	return `${baseSelector}${webState}`;
}

function translateProperties(properties: Record<string, string>): Record<string, string> {
	const webProps: Record<string, string> = {};
	const borderProps: Record<string, string> = {};

	const convertColor = (val?: string) => {
		if (!val) return 'transparent';
		const match = val.match(/rgba\(([\d.]+)%,([\d.]+)%,([\d.]+)%,([\d.]+)\)/);
		if (match) {
			const r = Math.round(parseFloat(match[1]) * 2.55);
			const g = Math.round(parseFloat(match[2]) * 2.55);
			const b = Math.round(parseFloat(match[3]) * 2.55);
			return `rgba(${r}, ${g}, ${b}, ${match[4]})`;
		}
		return val;
	};

	for (const [key, value] of Object.entries(properties)) {
		switch (key) {
			case 'background-color':
				webProps['background-color'] = convertColor(value);
				break;
			case 'color':
				webProps['color'] = convertColor(value);
				break;
			case 'font-family':
				webProps['font-family'] = value.replace(/-fm-font-family\(([^)]+)\)/, (_, fonts) => fonts.split(',').map(f => `"${f.trim()}"`).join(', '));
				break;
			case 'font-size':
			case 'text-align':
				webProps[key] = value;
				break;
			case 'padding-top':
			case 'padding-right':
			case 'padding-bottom':
			case 'padding-left':
				webProps[key] = value;
				break;
			case 'border-top-style': borderProps['style'] = value; break;
			case 'border-top-width': borderProps['width'] = value; break;
			case 'border-top-color': borderProps['color'] = convertColor(value); break;
		}
	}

	if (borderProps.width && borderProps.style && borderProps.color) {
		if (borderProps.style === 'none' || borderProps.width === '0pt') {
			webProps['border'] = 'none';
		} else {
			webProps['border'] = `${borderProps.width} ${borderProps.style} ${borderProps.color}`;
		}
	}

	const borderRadius = properties['border-top-left-radius']?.split(' ')[0];
	if (borderRadius) {
		webProps['border-radius'] = borderRadius;
	}

	return webProps;
}
