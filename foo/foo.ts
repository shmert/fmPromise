import fmPromise from '../src/fm-promise.js';

let user = await fmPromise.evaluate('Get(UserName)')
document.body.innerText = 'Hello, ' + user;

async function testTypeSafety() {
	// 1. As you type 'Abstract', the IDE should suggest valid layout names.
	const records = await fmPromise.executeFileMakerDataAPIRecords({
		layouts: 'Abstract',
	});

	// 2. The IDE should know `records` is an array of `AsMA_UHMS.Abstract`.
	// When you type `records[0].`, you should see suggestions for `fieldData` and `portalData`.
	const firstRecord = records[0];

	// 3. When you type `firstRecord.fieldData.`, you should see a list of fields like
	// "Abstract::title", etc.
	const title = firstRecord.fieldData['Abstract::title'];

	// 4. When you type `firstRecord.portalData.`, you should see portal names like "Abstract__CoAuthors".
	const coAuthors = firstRecord.portalData.Abstract__CoAuthors;

	// 5. When you type `coAuthors[0].`, you should see the fields from inside the portal.
	const firstCoAuthorFirstName = coAuthors[0]['Abstract__CoAuthors::firstName'];
}

testTypeSafety();
