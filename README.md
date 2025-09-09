## fmPromise: a Richer JavaScript Web Viewer Integration

FileMaker 19 has added the ability to call FileMaker scripts from your JavaScript, as well as executing a JavaScript function from a FileMaker script.
This allows for integration between FileMaker and JavaScript/WebViewer, but has some clunky bits that we can make better.

* Every call from JavaScript to a FileMaker script needs a public JavaScript function to receive the script response, and it is the responsibility of the Script to call that function.
* All data coming back from FileMaker is a `string`
* Debugging JavaScript errors is very difficult without browser-based dev tools
* The `window.FileMaker` object is not available right when the page loads, so you need a `window.setTimeout()` to wait for it to become available if you want to populate your web viewer using a script call.

**fmPromise** is designed to address these shortcomings, and help you utilize web viewers in your solution with the minimum amount of fuss.

Instead of callback-based JavaScript, `fmPromise` returns a [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) for cleaner, more modern code.

Add in the syntactic sugar of [async/await](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function) and you can have this:

```js
async function submitMyOrder(orderDetails) {
	const progressDialog = showProgressDialog('Submitting...');
	try {
		const submitResult = await fmPromise.performScript('Submit Order from WebViewer', orderDetails);
		showSubmitResult(submitResult);
	} catch (error) {
		showError('Could not send order: ' + error);
	} finally {
		progressDialog.close();
	}
}
```

In addition, fmPromise offers more convenient data structures for returned values. 

`fmPromise.executeSQL` return an array of arrays, instead of a string, and supports safe inlining of parameters. 

`fmPromise.executeFileMakerDataAPIRecords`  returns an array of objects, with portal data as attributes.

### Debugging

I would *strongly* recommend you enable external JavaScript debugging in your web viewer, as described [here](https://community.claris.com/en/s/question/0D50H00007uvYTVSA2/enable-inspect-element-with-right-click-in-webviewer-).

From your terminal, type:

```bash
defaults write com.FileMaker.client.pro12 WebKitDebugDeveloperExtrasEnabled -bool YES
```

This allows you to utilize Safari's developer tools on your web viewer code, which is incredibly useful.

### Using fmPromise

1. copy the `fmPromise` script from **fmPromiseScript.fmp12** to your file.
2. Add a web viewer to your layout.
    1. Give it the name `fmPromiseWebViewer`.
    2. Check "Allow JavaScript to perform FileMaker scripts".
    3. Uncheck "Automatically encode URL"
    4. Point the Web Address to your HTML file, either hosted, local, or a data URL reading from a field

### Packaging

Work in progress: start the fmPromise build server. Write your HTML using your IDE of preference. Use the fmPromiseBuild script to get the minified, single-file html payload and store that in your database in a text field.

Point your web viewer to this text field using a data URL, e.g. `"data:text/html," & WebView::schedule_board`

### API

`fmPromise.performScript(scriptName, parameter)` Performs a FileMaker script, returning a Promise. The Promise will be resolved with the script result (parsed as JSON if possible), or rejected if the FileMaker script result starts with the
word "ERROR".

`fmPromise.evaluate(expression, letVars)` Evaluate an expression in FileMaker using optional letVars. This is also a handy way to set $$GLOBAL variables.

```fmPromise.executeSql`select id, name from Team where color=${color}` ``` Performs an SQL query, returning results as an array of array. Embedded variables like `${color}` are parameterized safely using this method.

`fmPromise.executeFileMakerDataAPIRecords({layouts:'Team', limit:2})` Execute the data API, returning an array of Objects. Each object in the resulting array will have non-enumerable `recordId` and `modid` attributes. `portalData` arrays for each record will be inlined with other attributes, using the portal table name as the key.

### Additional benefits

* FileMaker worker scripts don't need to know anything about your web viewers, they simply exit with a (preferably JSON) result.
* FileMaker Scripts can return an "Error …" result, which will be used to reject the script call's promise.
* Each FileMaker script call has an id, so you can fire off multiple script calls to FileMaker and they will resolve correctly. Generally one-at-a-time execution, given FileMaker's single-threaded nature.
* You can make script calls as soon as your `<script type="module">` tag finishes loading, since `fmPromise` takes care of polling for the `window.FileMaker` object.

### Caveats

* The callback script defaults to looking for a webViewer named `fmPromiseWebViewer`. You can override the web viewer name in the JavaScript.
* When you use Perform Javascript in Web Viewer, you will not get a result if the performed method is `async`.

## Getting Started

Create a static HTML file and a JavaScript file (`fm-promise.ts`) in the same directory. All your application logic will go inside a single `<script type="module">` block, which allows you to use the modern `import` syntax.

Example:

```html
<!doctype html>
<script type="module">
	import fmPromise from 'fmPromise-github/src/fm-promise.ts'; // or https://cdn.jsdelivr.net/gh/shmert/fmPromise/fm-promise.min.js

	async function hello() {
		const name = await fmPromise.evaluate('Get(Username)');
		document.body.innerText = 'Hello, ' + name;
	}

	hello();
</script>
```

Now we want to display this in a Web Viewer in FileMaker.

Add a Web Viewer component to your FileMaker layout. For now, the Web Address can be a file pointing to your HTML file, e.g. `"file:///Users/myUserName/MyProject/hello-fmpromise.html"`.

**IMPORTANT:** check the box labeled "Allow JavaScript to perform FileMaker Scripts". Without this step, nothing will happen.

**IMPORTANT:** in the "Position" inspector, give your web viewer the Name `fmPromiseWebViewer`.

Now you should be able to go to browse mode and see the hello message displayed.

The following example loads Vue.js 3 from the internet, fetches all tables and fields from your FileMaker solution, and displays them as nested lists. Note how both `fmPromise` and `vue` are imported inside the module script.

```html
<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
</head>
<body>
<div id="app">
	<ol>
		<li v-for="table in tables">
			{{ table.name }}
			<ul>
				<li v-for="field in table.fields">
					{{ field.name }}
				</li>
			</ul>
		</li>
	</ol>
</div>

<script type="module">
	import fmPromise from 'fmPromise-github/src/fm-promise.ts';
	import {createApp} from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';

	createApp({
		data() {
			return {
				tables: {}
			}
		},
		async mounted() {
			const rows = await fmPromise.executeSql('select tableName, fieldName from filemaker_fields');

			this.tables = rows.reduce((result, eachRow) => {
				let tableName = eachRow[0];
				let fieldName = eachRow[1];
				const tbl = result[tableName] || (result[tableName] = {name: tableName, fields: []});
				tbl.fields.push({name: fieldName});
				return result;
			}, {});
		}
	}).mount('#app');
</script>
</body>
</html>
```
