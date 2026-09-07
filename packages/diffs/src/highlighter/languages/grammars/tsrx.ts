import type { LanguageRegistration } from 'shiki';
import css from 'shiki/langs/css.mjs';
import typescript from 'shiki/langs/typescript.mjs';

import grammar from './tsrx.tmLanguage';

// Include embedded grammars in the resolved payload so workers can load TSRX
// synchronously without importing languages themselves. See NOTICE.md for provenance.
const tsrx: LanguageRegistration[] = [
  ...css,
  ...typescript,
  {
    ...grammar,
    name: 'tsrx',
    displayName: 'TSRX',
    embeddedLangs: ['css', 'typescript'],
  },
];

export default tsrx;
