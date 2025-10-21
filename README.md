# fmPromise: a Richer JavaScript Web Viewer Integration

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

# Using fmPromise

Install the fmPromise Add-On, restart FileMaker, and add this to your FileMaker solution's add-ons. 

You can [download the fmPromise Add-On here](https://com-prosc-internal.s3.amazonaws.com/fmPromise.fmaddon.zip):

https://com-prosc-internal.s3.amazonaws.com/fmPromise.fmaddon.zip

Drag an fmPromise module to your FileMaker layout, enter Browser mode, and follow the instructions there.

# API

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


# Debugging

I would *strongly* recommend you enable external JavaScript debugging in your web viewer, as described [here](https://community.claris.com/en/s/question/0D50H00007uvYTVSA2/enable-inspect-element-with-right-click-in-webviewer-).

From your terminal, type:

```bash
defaults write com.FileMaker.client.pro12 WebKitDebugDeveloperExtrasEnabled -bool YES
```

This allows you to utilize Safari's developer tools on your web viewer code, which is incredibly useful.
