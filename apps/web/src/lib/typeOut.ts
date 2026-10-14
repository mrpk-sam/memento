/** Types text out 2 characters every 24ms, as the prototype does for fresh captions. */
export function typeOut(text: string, set: (t: string) => void) {
  return new Promise<void>((res) => {
    let i = 0;
    const iv = setInterval(() => {
      i = Math.min(text.length, i + 2);
      set(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(iv);
        res();
      }
    }, 24);
  });
}
