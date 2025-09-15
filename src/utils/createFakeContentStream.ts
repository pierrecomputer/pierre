import { queueRender } from '../pierre-js/UnversialRenderer';

export function createFakeContentStream(data: string, letterByLetter = false) {
  return new ReadableStream<string>({
    start(controller) {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      function pushNext() {
        if (data.length === 0) {
          controller.close();
          return;
        }

        const chunkSize = letterByLetter
          ? Math.min(4, data.length)
          : Math.min(Math.floor(Math.random() * 100) + 2, data.length);

        const nextData = data.slice(0, chunkSize);
        data = data.slice(chunkSize);
        controller.enqueue(nextData);

        if (letterByLetter) {
          queueRender(pushNext);
        } else {
          if (timeout != null) {
            clearTimeout(timeout);
          }
          timeout = setTimeout(pushNext, Math.random() * 100 + 100);
        }
      }
      if (letterByLetter) {
        queueRender(pushNext);
      } else {
        pushNext();
      }
    },
  });
}
