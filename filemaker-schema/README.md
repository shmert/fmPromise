# FileMaker Schema Directory

This directory is watched by the fm-promise-server to automatically generate TypeScript type definitions for your FileMaker solutions.

### Instructions

1.  In FileMaker Pro, open your solution and go to **File > Tools > Save a Copy as XML...**
2.  Save the XML file **directly into this directory**.

### Naming Convention is Important!

The name of the XML file determines the TypeScript namespace for your types.

-   **Rule:** Name the file after your solution (e.g., `YoyodyneAccounting.xml`).
-   **Result:** The server will generate a namespace called `YoyodyneAccounting`. Spaces and special characters will be removed.

These generated types will give you powerful autocompletion for the Data API in your IDE.
