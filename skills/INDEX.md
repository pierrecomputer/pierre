# Pierre package skills

Use these skills when an app or site consumes a Pierre package. Read the
selected `SKILL.md` first. Load only the API or recipe reference that matches
the task.

| Skill                       | Use it for                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| [diffs](diffs/SKILL.md)     | Render or edit code files, diffs, patches, and merge conflicts with `@pierre/diffs`.                |
| [theme](theme/SKILL.md)     | Select and load a Pierre syntax or editor theme from `@pierre/theme`.                               |
| [theming](theming/SKILL.md) | Build runtime theme collections, resolvers, controllers, and color mappings with `@pierre/theming`. |
| [trees](trees/SKILL.md)     | Render and control an interactive file tree with `@pierre/trees`.                                   |

## Package relationship

`@pierre/theme` supplies theme objects. `@pierre/theming` selects, resolves, and
maps those objects. `@pierre/diffs` and `@pierre/trees` render code and file
trees with the selected theme.
