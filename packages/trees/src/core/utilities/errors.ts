const prefix = 'Headless Tree: ';

export const throwError = (message: string) => Error(prefix + message);

export const logWarning = (message: string) => console.warn(prefix + message);
