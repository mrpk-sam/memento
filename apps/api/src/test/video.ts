import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const run = promisify(execFile);

/** Makes a short test clip with ffmpeg's built-in sources, e.g. makeClip('a.avi', ['-c:v', 'mpeg4']). */
export async function makeClip(name: string, args: string[], seconds = 3) {
  const dir = await mkdtemp(join(tmpdir(), 'memento-clip-'));
  try {
    const out = join(dir, name);
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=25:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=duration=${seconds}`, '-shortest', ...args, out]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
