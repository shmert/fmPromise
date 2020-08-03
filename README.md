## fmPromise: a Richer JavaScript Web Viewer Integration

FileMaker 19 has added the ability to call FileMaker scripts from your JavaScript, as well as executing a JavaScript function from a FileMaker script. 
This allows for integration between FileMaker and JavaScript/WebViewer, but has some clunky bits that we can make better.

* Every call from JavaScript to a FileMaker script needs a public JavaScript function to receive the script response, and it is the responsibility of the Script to call that function.
* All data coming back from FileMaker is a `string`
* Debugging JavaScript errors is very difficult without browser-based dev tools
* The `window.FileMaker` object is not available right when the page loads, so you need a `window.setTimeout()` to wait for it to become available if you want to populate your web viewer using a script call.

**fmPromise** is designed to address these shortcomings, and help you utilize web viewers in your solution with the minimum amount of fuss.

Long story short, instead of JavaScript like this:

```js
function submitMyOrder(orderDetails) {
	window.progressDialog = showProgressDialog('Submitting...'); // global scope, not ideal
	const scriptParam = JSON.stringify(orderDetails); // convert JS object to string
	try {
		window.FileMaker.PerformScript('Submit Order from WebViewer', scriptParam); // no return value
	} catch (e) {
		showError('Could not call script "Submit Order from WebViewer", was it renamed?" ' + e);
	}
}

// the FileMaker `Submit Order from WebViewer` script is responsible for calling this on success 
function submitOrderSuccessCallback(payloadString) {
	const submitResult = JSON.parse(payloadString); // convert string to JS objects
	showSubmitResult(submitResult);
	window.progressDialog.close();
}

// the FileMaker `Submit Order from WebViewer` script is responsible for calling this on failure 
function submitOrderErrorCallback(msg) {
	showError('Could not send order: ' + msg);
	window.progressDialog.close();
}
```

With `fmPromise`, the call to `fmPromise.performScript()` returns a [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) complete with error handling. This lets you write JavaScript like this:

```js
// WITH fmPromise, the call to performScript returns a Promise
// the `ScriptResult` of `Find Matching Contacts` will be parsed as JSON and used to resolve the Promise
function submitMyOrder(orderDetails) {
	const progressDialog = showProgressDialog('Submitting...'); // block scope
	fmPromise.performScript('Submit Order from WebViewer', orderDetails) // returns a Promise
		.then(function (submitResult) {
			showSubmitResult(submitResult);
		})
		.catch(function (error) {
			showError('Could not send order: ' + error);
		}).finally(function () {
		progressDialog.close();
	})
}
```

Add in the syntactic sugar of [async/await](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function) and you can have this:

```js
async function submitMyOrder(orderDetails) {
	const progressDialog = showProgressDialog('Submitting...');
	try {
		const submitResult = await fmPromise.performScript('Submit Order from WebViewer', orderDetails);
		showSubmitResult(submitResult);
	} catch (error) {
		showError('Could not send order: ' + msg);
	} finally {
		progressDialog.close();
	}
}
```

### API
`fmPromise.performScript(scriptName, parameter)` Performs a FileMaker script, returning a Promise. The Promise will be resolved with the script result (parsed as JSON if possible), or rejected if the FileMaker script result starts with the word "ERROR".

`fmPromise.evaluate(expression, letVars)` Evaluate an expression in FileMaker using optional letVars. This is also a handy way to set $$GLOBAL variables.

`fmPromise.insertFromUrl(url, curlOptions)` Inserts from URL without worrying about cross-site scripting limitations imposed on the web viewer.

`fmPromise.setFieldByName(url, curlOptions)` Sets a field by name in FileMaker.

`fmPromise.executeSql(sql, ...bindings)` Executes a SQL command with placeholders, parsing the plain-text delimited result into an array of arrays.

`fmPromise.setDebugEnabled(yn)` Redirects console messages to display at the bottom of the screen, handy for Web Viewer which lacks developer tools.

`fmPromise.package(htmlFileName, fmFieldNameToSet)` Given an html file, this uses fmPromise to get the file contents, parse it as DOM, and inline any external references.

### Additional benefits

* FileMaker worker scripts don't need to know anything about your web viewers, they simply exit with a (preferably JSON) result.
* FileMaker Scripts can return an "Error …" result, which will be used to reject the script call's promise.
* Each FileMaker script call has an id, so you can fire off multiple script calls to FileMaker and they will resolve correctly.
* You can make script calls as soon as your `<script>` tag finishes loading, since `fmPromise` takes care of polling for the `window.FileMaker` object.


### Caveats

* The callback script defaults to looking for a webViewer named `fmPromiseWebViewer`. It would be nice if the JavaScript `FileMaker` object had this as a property. You can override the web viewer name in the JavaScript.
* Whe you use Perform Javascript in Web Viewer, you will not get a result if the script your are calling is an async script.

## Getting Started
Create a static HTML file and include the `fm-promise.js` file. Add another `<script>` block for your own JavaScript. Your script can utilize `fmPromise` immediately on page load to do things like call FileMaker scripts, evaluate expressions, and execute SQL.

Example:

```html
<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<script src="fm-promise.js"></script>
</head>
<body>
</body>
<script>
	'use strict';

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

The following loads vue.js from the internet and then fetches all tables and fields from your FileMaker solution and displays them as nested lists.

```html
<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<script src="fm-promise.js"></script>
	<script src="https://cdn.jsdelivr.net/npm/vue/dist/vue.js"></script>
	<script>
		async function fetchSchema() {
			const rows = await fmPromise.executeSql('select tableName, fieldName from filemaker_fields');
			const tables = rows.reduce((result, eachRow) => {
				let tableName = eachRow[0];
				let fieldName = eachRow[1];
				const tbl = result[tableName] || (result[tableName] = {name: tableName, fields: []});
				tbl.fields.push({name: fieldName});
				return result;
			}, {});

			new Vue({
				el: '#app',
				data: {tables}
			})
		}

		fetchSchema();
	</script>
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
</body>
</html>
```

