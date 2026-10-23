/**
 * A continuous piecewise-linear function of one container size, for sizes
 * from 0 up. The layout's `min()`, `max()`, and `clamp()` of linear values
 * give such a function, so each box edge can be written as one short CSS
 * value of the container size, with no custom properties.
 */
export interface Piecewise {
  /** Knot positions in ascending order. The first knot is 0. */
  readonly xs: readonly number[];
  /** The value at each knot. */
  readonly ys: readonly number[];
  /** The slope after the last knot. */
  readonly slope: number;
}

// Knots closer than this, and slope changes smaller than this, are the same.
const EPSILON = 1e-9;

export function constant(value: number): Piecewise {
  return { xs: [0], ys: [value], slope: 0 };
}

/** The container size itself. */
export function size(): Piecewise {
  return { xs: [0], ys: [0], slope: 1 };
}

export function evaluate(f: Piecewise, x: number): number {
  const { xs, ys } = f;
  const last = xs.length - 1;
  if (x >= xs[last]) return ys[last] + f.slope * (x - xs[last]);
  let index = 0;
  while (xs[index + 1] <= x) index++;
  const t = (x - xs[index]) / (xs[index + 1] - xs[index]);
  return ys[index] + t * (ys[index + 1] - ys[index]);
}

/** The slope of `f` on each segment: between knots, then after the last. */
function slopes(f: Piecewise): number[] {
  const result: number[] = [];
  for (let index = 0; index < f.xs.length - 1; index++)
    result.push(
      (f.ys[index + 1] - f.ys[index]) / (f.xs[index + 1] - f.xs[index])
    );
  result.push(f.slope);
  return result;
}

function union(a: readonly number[], b: readonly number[]): number[] {
  const all = [...a, ...b].sort((x, y) => x - y);
  return all.filter((x, index) => index === 0 || x - all[index - 1] > EPSILON);
}

/** Drop knots where the slope does not change. */
function simplify(xs: number[], ys: number[], slope: number): Piecewise {
  const keptX = [xs[0]];
  const keptY = [ys[0]];
  for (let index = 1; index < xs.length; index++) {
    const before =
      (ys[index] - keptY[keptY.length - 1]) /
      (xs[index] - keptX[keptX.length - 1]);
    const after =
      index + 1 < xs.length
        ? (ys[index + 1] - ys[index]) / (xs[index + 1] - xs[index])
        : slope;
    if (Math.abs(after - before) > EPSILON) {
      keptX.push(xs[index]);
      keptY.push(ys[index]);
    }
  }
  return { xs: keptX, ys: keptY, slope };
}

export function add(f: Piecewise, g: Piecewise): Piecewise {
  const xs = union(f.xs, g.xs);
  return simplify(
    xs,
    xs.map((x) => evaluate(f, x) + evaluate(g, x)),
    f.slope + g.slope
  );
}

export function scale(f: Piecewise, factor: number): Piecewise {
  return {
    xs: f.xs,
    ys: f.ys.map((y) => y * factor),
    slope: f.slope * factor,
  };
}

/** The lower (`sign` 1) or upper (`sign` -1) envelope of two functions. */
function envelope(f: Piecewise, g: Piecewise, sign: 1 | -1): Piecewise {
  const knots = union(f.xs, g.xs);
  const difference = (x: number): number =>
    sign * (evaluate(f, x) - evaluate(g, x));
  const xs: number[] = [];
  for (let index = 0; index < knots.length; index++) {
    const x = knots[index];
    xs.push(x);
    const d = difference(x);
    // A crossing between two knots, or after the last knot.
    const next = knots[index + 1];
    if (next !== undefined) {
      const e = difference(next);
      if ((d > EPSILON && e < -EPSILON) || (d < -EPSILON && e > EPSILON))
        xs.push(x + ((next - x) * d) / (d - e));
    } else {
      const rate = sign * (f.slope - g.slope);
      if ((d > EPSILON && rate < 0) || (d < -EPSILON && rate > 0))
        xs.push(x - d / rate);
    }
  }
  const pick = (x: number): number =>
    sign === 1
      ? Math.min(evaluate(f, x), evaluate(g, x))
      : Math.max(evaluate(f, x), evaluate(g, x));
  // After the last knot, the lower (or upper) function stays below (above).
  const end = xs[xs.length - 1] + 1;
  const slope =
    sign * (evaluate(f, end) - evaluate(g, end)) <= 0 ? f.slope : g.slope;
  return simplify(xs, xs.map(pick), slope);
}

export function min(f: Piecewise, g: Piecewise): Piecewise {
  return envelope(f, g, 1);
}

export function max(f: Piecewise, g: Piecewise): Piecewise {
  return envelope(f, g, -1);
}

/** CSS `clamp(lower, value, upper)`: the upper bound wins over the lower. */
export function clamp(
  lower: Piecewise,
  value: Piecewise,
  upper: Piecewise
): Piecewise {
  return max(lower, min(value, upper));
}

// Eight significant digits keep a box within 0.0001 px on a 10,000 px container.
const format = (value: number): string => String(Number(value.toPrecision(8)));

/**
 * Write `f` as one CSS value of the container size `unit` (`100cqw`):
 * `f(0) + s0 × size + Σ (sᵢ − sᵢ₋₁) × max(0px, size − xᵢ)`, where sᵢ is the
 * slope after knot xᵢ. Each knot adds one hinge term, which is 0 below it.
 */
export function toCSS(f: Piecewise, unit: string): string {
  const rates = slopes(f);
  const terms: string[] = [];
  if (Math.abs(rates[0]) > EPSILON)
    terms.push(rates[0] === 1 ? unit : `${format(rates[0])} * ${unit}`);
  for (let index = 1; index < f.xs.length; index++) {
    const change = rates[index] - rates[index - 1];
    if (Math.abs(change) <= EPSILON) continue;
    const hinge = `max(0px, ${unit} - ${format(f.xs[index])}px)`;
    terms.push(change === 1 ? hinge : `${format(change)} * ${hinge}`);
  }
  if (Math.abs(f.ys[0]) > EPSILON || terms.length === 0)
    terms.unshift(`${format(f.ys[0])}px`);
  if (terms.length === 1 && !terms[0].includes(' ')) return terms[0];
  return `calc(${terms.join(' + ')})`;
}
