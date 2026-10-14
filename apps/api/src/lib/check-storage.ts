import { env } from '../env.js';
import { createStorage } from './s3.js';

const s = createStorage(env());
s.ensureBucket()
  .then((r) => console.log(`Bucket "${s.bucket}" ${r}`))
  .catch((e) => {
    console.error('Storage check failed:', e.message ?? e);
    process.exit(1);
  });
