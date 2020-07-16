## fmPromise: a Richer JavaScript Web Viewer Integration

FileMaker 19 has added the ability to call FileMaker scripts from your JavaScript, as well as executing a JavaScript function from a FileMaker script. 
This allows for integration between FileMaker and JavaScript/WebViewer, but has some clunky bits that we can make better.

* Every call from JavaScript to a FileMaker script needs a public JavaScript function to receive the script response, and it is the responsibility of the Script to call that function.
* All data coming back from FileMaker is a `string`
* Debugging JavaScript errors is very difficult without browser-based dev tools
* The `window.FileMaker` object is not available right when the page loads, so you need a `window.setTimeout()` to wait for it to become available if you want to populate your web viewer using a script call.

**fmPromise** is designed to address these shortcomings.

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

`fmPromise.executeSql(sql, ...bindings)` Executes a SQL command with placeholders, parsing the plain-text delimited result into an array of arrays.

`fmPromise.enableDebugging()` Redirects console messages to display at the bottom of the screen, handy for Web Viewer which lacks developer tools.

### Additional benefits

* FileMaker worker scripts don't need to know anything about your web viewers, they simply exit with a (preferably JSON) result.
* FileMaker Scripts can return an "Error …" result, which will be used to reject the script call's promise.
* Each FileMaker script call has an id, so you can fire off multiple script calls to FileMaker and they will resolve correctly.
* You can make script calls as soon as your `<script>` tag finishes loading, since `fmPromise` takes care of polling for the `window.FileMaker` object.




### Caveats

The callback script defaults to looking for a webViewer named `fmPromiseWebViewer`. It would be nice if the JavaScript `FileMaker` object had this as a property. You can override the web viewer name in the JavaScript.
