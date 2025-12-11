import { preloadFile } from '@pierre/diffs/ssr';

import { ProseWrapper } from '../ProseWrapper';
import { INSTALLATION_EXAMPLES, PACKAGE_MANAGERS } from './constants';
import Content from './content.mdx';

export async function InstallationSection() {
  const installationExamples = Object.fromEntries(
    await Promise.all(
      PACKAGE_MANAGERS.map(async (pm) => [
        pm,
        await preloadFile(INSTALLATION_EXAMPLES[pm]),
      ])
    )
  );

  return (
    <ProseWrapper>
      <Content installationExamples={installationExamples} />
    </ProseWrapper>
  );
}
