# Important note

The `git-platform-sync` folder here is a symlink to the
`packages/storage-elements/shadcn/blocks/git-platform-sync` folder.

This is because we want to be able to develop the package outside of the docs,
but the shadcn registry that we serve from the docs works a lot better when
these files are local. You don't need to update them in both places, however, if
there's a dependency added to the components, it does now need to be installed
in both packages.
