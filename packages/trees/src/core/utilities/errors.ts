const prefix = 'Headless Tree: ';

export const throwError = (message: string) => Error(prefix + message);

// eslint-disable-next-line no-console
export const logWarning = (message: string) => console.warn(prefix + message);
