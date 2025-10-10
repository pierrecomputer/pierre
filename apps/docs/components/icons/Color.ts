// Icon colors are mapped to global colors that are adaptive to dark and light modes.
// They're extremely limited compared to the full color palette.
export type Color = {
  black: string;
  white: string;

  purple: string;
  green: string;
  red: string;
  yellow: string;
  blue: string;

  fg: string;
  fg1: string;
  fg2: string;
  fg3: string;
  fg4: string;

  bg: string;
  border: string;
};

export const Colors = {
  black: 'var(--color-black)',
  white: 'var(--color-white)',

  purple: 'var(--ui-theme-primary-icon)',
  green: 'var(--ui-theme-success-icon)',
  red: 'var(--ui-theme-danger-icon)',
  yellow: 'var(--ui-theme-warning-icon)',
  blue: 'var(--ui-theme-primary-icon)',

  fg: 'var(--color-fg)',
  fg1: 'var(--color-fg1)',
  fg2: 'var(--color-fg2)',
  fg3: 'var(--color-fg3)',
  fg4: 'var(--color-fg4)',

  bg: 'var(--color-bg)',
  border: 'var(--color-border)',
};
