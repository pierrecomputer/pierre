- Build the tree keyed by hashed IDs from the start (or maintain parallel
  path->id during graph build) to remove the standalone `hashTreeKeys` pass
  entirely. A partial attempt that pre-hashed references during folder-node
  creation regressed due `buildFolderNodes` overhead, so any retry should avoid
  moving heavy remap work into that stage.
