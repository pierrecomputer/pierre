'use client';

// `corners()`: a handle where a separator of a row meets a separator of a
// column. A drag on it resizes both separators. Corners at the same point
// join, so one drag moves every separator that meets there. A corner is a
// pointer shortcut only: the keyboard resizes each separator, so the corner
// takes no focus and assistive technology does not see it.
import { type CSSCorner, cssCorners } from '../../corners';
import type { CSSLayout } from '../../css-layout';
import cornersCss from '../../css/corners.css?inline';
import { separatorIdsAt } from '../../dom/panes';
import { presentation } from '../../presentation';
import type { Feature, FeatureModule } from '../contract';
import { CORNER_GESTURE_STYLE } from '../gesture-styles';

const cornerLists = new WeakMap<CSSLayout, CSSCorner[]>();

/** The corners of a compiled tree, computed once for each tree. */
export function cornersOf(layout: CSSLayout): CSSCorner[] {
  let list = cornerLists.get(layout);
  if (list === undefined) {
    list = cssCorners(layout);
    cornerLists.set(layout, list);
  }
  return list;
}

/** Show a resize handle at each corner where two separators meet. */
export function corners(): Feature {
  const feature: FeatureModule = {
    name: 'corners',
    stylesheets: [['corners', cornersCss]],
    use(context, { state, geometry }) {
      const list = cornersOf(geometry);
      // No corner while a pane fills the layout, as no separator.
      const shown = presentation(state).rearrangeable;
      return {
        layers: () =>
          shown &&
          list.map((corner) => (
            <div
              key={corner.id}
              className="pierre-layouts-corner"
              aria-hidden
              style={{
                left: corner.left,
                top: corner.top,
                ...CORNER_GESTURE_STYLE,
              }}
              data-layouts-corner={corner.id}
              data-layouts-flip={`corner:${corner.id}`}
              onPointerDown={(event) => {
                const element = context.element();
                context.startResize(
                  event,
                  element === null
                    ? corner.separatorIds
                    : [
                        ...separatorIdsAt(
                          element,
                          event.currentTarget,
                          corner.separatorIds,
                          list
                        ),
                      ]
                );
              }}
            />
          )),
      };
    },
  };
  return feature;
}
