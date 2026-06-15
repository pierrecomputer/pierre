export type Roles = {
  bg: {
    editor: string; // main editor background (brightest in light, darkest in dark)
    window: string; // sidebar, activity bar, status bar, title bar, inactive tabs
    inset: string; // inputs, dropdowns
    elevated: string; // panels, hover backgrounds
  };
  fg: { base: string; fg1: string; fg2: string; fg3: string; fg4: string };
  border: {
    window: string; // borders for sidebar, activity bar, status bar, title bar
    editor: string; // general editor borders
    indentGuide: string; // indent guide lines
    indentGuideActive: string; // active indent guide line
    inset: string; // borders for inputs, dropdowns
    elevated: string; // borders for panels
  };
  accent: {
    primary: string;
    link: string;
    subtle: string;
    contrastOnAccent: string;
  };
  states: {
    merge: string;
    success: string;
    danger: string;
    warn: string;
    info: string;
  };
  syntax: {
    comment: string;
    string: string;
    number: string;
    keyword: string;
    regexp: string;
    func: string;
    type: string;
    variable: string;
    // Extended token types
    operator: string;
    punctuation: string;
    constant: string;
    parameter: string;
    namespace: string;
    decorator: string;
    escape: string;
    invalid: string;
    tag: string;
    attribute: string;
  };
  ansi: {
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
};
