import {
  getPreparedInputEntries,
  PathStoreBuilder as InternalPathStoreBuilder,
  prepareInput as prepareCanonicalInput,
} from './builder';
import type { InternalPreparedInput, PreparedPath } from './internal-types';
import { parseInputPath } from './path';
import type { PathStoreOptions, PathStorePreparedInput } from './public-types';

/**
 * Public append-only builder for `PathStorePreparedInput` snapshots.
 *
 * Trees bulk ingest needs a small public seam that can validate chunk ordering
 * incrementally without reaching into path-store internals.
 */
export class PathStorePreparedInputBuilder {
  readonly #builder: InternalPathStoreBuilder;
  readonly #options: PathStoreOptions;
  readonly #paths: string[] = [];
  readonly #preparedPaths: PreparedPath[] = [];

  public constructor(options: PathStoreOptions = {}) {
    this.#builder = new InternalPathStoreBuilder(options);
    this.#options = options;
  }

  public appendPaths(paths: readonly string[]): this {
    const preparedInput = prepareCanonicalInput(paths, this.#options);
    const preparedPaths = getPreparedInputEntries(preparedInput);
    this.#builder.appendPreparedPaths(preparedPaths);
    this.#preparedPaths.push(...preparedPaths);
    this.#paths.push(...preparedInput.paths);
    return this;
  }

  public appendPresortedPaths(
    paths: readonly string[],
    _containsDirectories: boolean | null = null
  ): this {
    const preparedPaths = paths.map((path) => parseInputPath(path));
    this.#builder.appendPreparedPaths(preparedPaths);
    this.#preparedPaths.push(...preparedPaths);
    this.#paths.push(...preparedPaths.map((entry) => entry.path));
    return this;
  }

  public build(): PathStorePreparedInput {
    const preparedInput: InternalPreparedInput = {
      paths: [...this.#paths],
      preparedPaths: [...this.#preparedPaths],
    };
    return preparedInput;
  }
}
