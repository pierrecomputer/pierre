/** Evaluate a value that `toCSS` wrote, for a container size in pixels. */
export function evaluateCSS(value: string, containerSize: number): number {
  const terms = (value.startsWith('calc(') ? value.slice(5, -1) : value).split(
    ' + '
  );
  let total = 0;
  for (const term of terms) {
    const hinge =
      /^(?:(-?[\d.e-]+) \* )?max\(0px, 100cq[wh] - (-?[\d.e-]+)px\)$/.exec(
        term
      );
    const linear = /^(-?[\d.e-]+) \* 100cq[wh]$/.exec(term);
    if (hinge !== null)
      total +=
        Number(hinge[1] ?? 1) * Math.max(0, containerSize - Number(hinge[2]));
    else if (linear !== null) total += Number(linear[1]) * containerSize;
    else if (/^100cq[wh]$/.test(term)) total += containerSize;
    else if (term.endsWith('px')) total += Number(term.slice(0, -2));
    else throw new Error(`Unknown term: ${term}`);
  }
  return total;
}
