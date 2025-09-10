export function createFakeContentStream(data: string) {
  return new ReadableStream<string>({
    start(controller) {
      const randomizedData = (() => {
        const chunks: string[] = [];
        let remaining = data;
        while (remaining.length > 0) {
          const chunkSize = Math.floor(Math.random() * 100) + 2;
          chunks.push(remaining.slice(0, chunkSize));
          remaining = remaining.slice(chunkSize);
        }
        return chunks;
      })();
      let timeout: NodeJS.Timeout | null = null;
      function pushNext() {
        const nextData = randomizedData.shift();
        if (nextData == null) {
          controller.close();
          if (timeout != null) {
            clearTimeout(timeout);
          }
          return;
        }
        controller.enqueue(nextData);
        if (timeout != null) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(pushNext, Math.random() + 100);
      }
      pushNext();
    },
  });
}
