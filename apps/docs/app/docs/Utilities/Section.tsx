import { preloadFile } from '@pierre/diffs/ssr';

import { ProseWrapper } from '../ProseWrapper';
import {
  HELPER_DIFF_ACCEPT_REJECT,
  HELPER_DIFF_ACCEPT_REJECT_REACT,
  HELPER_DISPOSE_HIGHLIGHTER,
  HELPER_GET_SHARED_HIGHLIGHTER,
  HELPER_PARSE_DIFF_FROM_FILE,
  HELPER_PARSE_PATCH_FILES,
  HELPER_PRELOAD_HIGHLIGHTER,
  HELPER_REGISTER_CUSTOM_THEME,
  HELPER_SET_LANGUAGE_OVERRIDE,
} from './constants';
import Content from './content.mdx';

export async function UtilitiesSection() {
  const [
    diffAcceptReject,
    diffAcceptRejectReact,
    disposeHighlighter,
    getSharedHighlighter,
    parseDiffFromFile,
    parsePatchFiles,
    preloadHighlighter,
    registerCustomTheme,
    setLanguageOverride,
  ] = await Promise.all([
    preloadFile(HELPER_DIFF_ACCEPT_REJECT),
    preloadFile(HELPER_DIFF_ACCEPT_REJECT_REACT),
    preloadFile(HELPER_DISPOSE_HIGHLIGHTER),
    preloadFile(HELPER_GET_SHARED_HIGHLIGHTER),
    preloadFile(HELPER_PARSE_DIFF_FROM_FILE),
    preloadFile(HELPER_PARSE_PATCH_FILES),
    preloadFile(HELPER_PRELOAD_HIGHLIGHTER),
    preloadFile(HELPER_REGISTER_CUSTOM_THEME),
    preloadFile(HELPER_SET_LANGUAGE_OVERRIDE),
  ]);

  return (
    <ProseWrapper>
      <Content
        diffAcceptReject={diffAcceptReject}
        diffAcceptRejectReact={diffAcceptRejectReact}
        disposeHighlighter={disposeHighlighter}
        getSharedHighlighter={getSharedHighlighter}
        parseDiffFromFile={parseDiffFromFile}
        parsePatchFiles={parsePatchFiles}
        preloadHighlighter={preloadHighlighter}
        registerCustomTheme={registerCustomTheme}
        setLanguageOverride={setLanguageOverride}
      />
    </ProseWrapper>
  );
}
