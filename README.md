## fmPromise: a Richer JavaScript Web Viewer Integration

FileMaker 19 has added the ability to call FileMaker scripts from your JavaScript, as well as executing a JavaScript function from a FileMaker script.
This allows for integration between FileMaker and JavaScript/WebViewer, but has some clunky bits that we can make better.

*   Every call from JavaScript to a FileMaker script needs a public JavaScript function to receive the script response, and it is the responsibility of the Script to call that function.
*   All data coming back from FileMaker is a `string`
*   Debugging JavaScript errors is very difficult without browser-based dev tools
*   The `window.FileMaker` object is not available right when the page loads, so you need a `window.setTimeout()` to wait for it to become available if you want to populate your web viewer using a script call.

**fmPromise** is designed to address these shortcomings, and help you utilize web viewers in your solution with the minimum amount of fuss.

Long story short, instead of callback-based JavaScript, `fmPromise` returns a [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) for cleaner, more modern code.

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

### Debugging

I would *strongly* recommend you enable external JavaScript debugging in your web viewer, as described [here](https://community.claris.com/en/s/question/0D50H00007uvYTVSA2/enable-inspect-element-with-right-click-in-webviewer-).

From your terminal, type:
```bash
defaults write com.FileMaker.client.pro12 WebKitDebugDeveloperExtrasEnabled -bool YES
```
This allows you to utilize Safari's developer tools on your web viewer code, which is incredibly useful.

### Packaging

The FMPromise Add-On workflow is:
1.  Create a new module, which writes my-module.html to your `Documents/fmPromise/` directory.
2.  Edit this file and preview it in `$$FMPROMISE_DEVMODE`
3.  Once satisfied, package the module into the `fmPromiseModule` table

This packaging step gets the source of your .html file, and optionally inlines any external JavaScript / CSS files.

If you want to change the inline behavior of a script or style, add a `data-package` attribute to your `<script>` or `<link>` tag containing your JavaScript / CSS.

*   `data-package="omit"` will remove the tag entirely. This is handy for things which you only want present in dev mode, like Vue Dev Tools.
*   `data-package="leave"` will not inline the file, but it will remain as an external resource. This is good for large external libraries, but means your module will probably not work without internet access.

### API

`fmPromise.performScript(scriptName, parameter)` Performs a FileMaker script, returning a Promise. The Promise will be resolved with the script result (parsed as JSON if possible), or rejected if the FileMaker script result starts with the word "ERROR".

`fmPromise.evaluate(expression, letVars)` Evaluate an expression in FileMaker using optional letVars. This is also a handy way to set $$GLOBAL variables.

`fmPromise.insertFromUrl(url, curlOptions)` Inserts from URL without worrying about cross-site scripting limitations imposed on the web viewer.

`fmPromise.setFieldByName(url, curlOptions)` Sets a field by name in FileMaker.

`fmPromise.executeSql(sql, ...bindings)` Executes a SQL command with placeholders, parsing the plain-text delimited result into an array of arrays.

`fmPromise.setDebugEnabled(yn)` Redirects console messages to display at the bottom of the screen, handy for Web Viewer which lacks developer tools.

`fmPromise.package(htmlFileName, fmFieldNameToSet)` Given an html file, this uses fmPromise to get the file contents, parse it as DOM, and inline any external references.

### Additional benefits

*   FileMaker worker scripts don't need to know anything about your web viewers, they simply exit with a (preferably JSON) result.
*   FileMaker Scripts can return an "Error …" result, which will be used to reject the script call's promise.
*   Each FileMaker script call has an id, so you can fire off multiple script calls to FileMaker and they will resolve correctly.
*   You can make script calls as soon as your `<script type="module">` tag finishes loading, since `fmPromise` takes care of polling for the `window.FileMaker` object.

### Caveats

*   The callback script defaults to looking for a webViewer named `fmPromiseWebViewer`. You can override the web viewer name in the JavaScript.
*   When you use Perform Javascript in Web Viewer, you will not get a result if the script your are calling is an `async` script.

## Getting Started

Create a static HTML file and a JavaScript file (`fm-promise.js`) in the same directory. All your application logic will go inside a single `<script type="module">` block, which allows you to use the modern `import` syntax.

Example:

```html
<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
</head>
<body>
</body>
<script type="module">
	import fmPromise from './fm-promise.js';

	async function hello() {
		const name = await fmPromise.evaluate('Get(Username)');
		document.body.innerText = 'Hello, ' + name;
	}

	hello();
</script>
</html>
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
	import fmPromise from './fm-promise.js';
	import { createApp } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';

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
