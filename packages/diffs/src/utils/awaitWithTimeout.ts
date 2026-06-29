export async function awaitWithTimeout(
  callback: () => Promise<unknown>,
  timeout: number = 300
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      callback(),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, timeout);
      }),
    ]);
  } finally {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
  }
}
