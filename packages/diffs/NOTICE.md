# Third-party notices

## TSRX TextMate grammar

`src/highlighter/languages/grammars/tsrx.tmLanguage.ts` is vendored from
[tsrx-org/tsrx](https://github.com/tsrx-org/tsrx/blob/c88c913c21f9c61bf34c58724b7a00d95b423d85/grammars/textmate/tsrx.tmLanguage.json)
at commit `c88c913c21f9c61bf34c58724b7a00d95b423d85` (MIT licensed). The grammar
rules are unchanged and wrapped in a typed module for the package build. The
adjacent `tsrx.ts` module supplies Shiki's language identifier and embedded
grammar registrations.

To update, replace the grammar object from a new pinned TSRX commit, update this
notice, and run `moon run diffs:test diffs:typecheck root:format root:lint`.

MIT License

Copyright (c) 2025 Dominic Gannaway

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## TypeScript TextMate grammar

The TSRX grammar derives from Microsoft's
[TypeScript-TmLanguage](https://github.com/microsoft/TypeScript-TmLanguage/tree/48f608692aa6d6ad7bd65b478187906c798234a8)
at commit `48f608692aa6d6ad7bd65b478187906c798234a8` and retains its MIT
license.

Copyright (c) Microsoft Corporation All rights reserved.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
