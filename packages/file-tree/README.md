# @pierre/diffs

Docs at [https://diffs.com](https://diffs.com)

## Development

### Building

```bash
bun run build
```

### Testing

```bash
# Run tests
bun test

# Update snapshots
bun test --update-snapshots

# Type checking
bun run tsc
```

Tests are located in the `test/` folder and use Bun's native testing framework
with snapshot support.
