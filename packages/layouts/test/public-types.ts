// Checks of the public types, which the typecheck runs and no test runner
// executes: an app names and passes a feature, and sees none of its members
// (`DEC-layouts-public-surface`).
import { createLayout, type Feature, zoom } from '../src/react';

const feature: Feature = zoom();
// @ts-expect-error A feature has no public members.
void feature.name;
// @ts-expect-error An app does not write a feature.
const own: Feature = { name: 'mine' };
void createLayout({ type: 'pane', id: 'a' }, [feature, own]);
