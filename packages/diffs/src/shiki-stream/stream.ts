import type { DiffsStreamTokenizer } from '../highlighter/tokenizer-types';
import type { ThemedToken } from '../highlighter/types';
import type { CodeToTokenTransformStreamOptions, RecallToken } from './types';

/**
 * Create a transform stream that takes code chunks and emits themed tokens.
 */
export class CodeToTokenTransformStream extends TransformStream<
  string,
  ThemedToken | RecallToken
> {
  readonly tokenizer: DiffsStreamTokenizer;
  readonly options: CodeToTokenTransformStreamOptions;

  constructor(options: CodeToTokenTransformStreamOptions) {
    const tokenizer = options.highlighter.createStreamTokenizer(options);
    const { allowRecalls = false } = options;

    const transformer: Transformer<string, ThemedToken | RecallToken> & {
      cancel(): void;
    } = {
      async transform(chunk, controller) {
        try {
          const {
            stable,
            unstable: buffer,
            recall,
          } = await tokenizer.enqueue(chunk);
          if (allowRecalls && recall > 0) {
            controller.enqueue({ recall });
          }
          for (const token of stable) {
            controller.enqueue(token);
          }
          if (allowRecalls) {
            for (const token of buffer) {
              controller.enqueue(token);
            }
          }
        } catch (error) {
          tokenizer.dispose();
          throw error;
        }
      },
      flush(controller) {
        try {
          const { stable } = tokenizer.close();
          // With recalls, the final provisional tokens have already been sent.
          if (!allowRecalls) {
            for (const token of stable) {
              controller.enqueue(token);
            }
          }
        } finally {
          tokenizer.dispose();
        }
      },
      cancel() {
        tokenizer.dispose();
      },
    };
    super(transformer);

    this.tokenizer = tokenizer;
    this.options = options;
  }
}
