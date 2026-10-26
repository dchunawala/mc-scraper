import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = typeof import.meta.url === 'string'
  ? path.dirname(fileURLToPath(import.meta.url))
  : path.join(process.cwd(), 'server', 'models');
const snapshotPath = path.join(currentDir, '..', 'data', 'mcc-snapshot.json');

export const readSnapshot = () => {
  try {
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  } catch {
    return { semesters: [], rooms: [], classes: [] };
  }
};

export const writeSnapshot = (snapshot) => {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
};
