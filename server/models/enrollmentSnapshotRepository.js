import { getCollection, formatDocuments } from './index.js';
import { LocalStorageEnrollmentSnapshotRepository } from './localStorageAdapter.js';

// Check if localStorage should be used
const USE_LOCAL_STORAGE = (process.env.NODE_ENV === 'localStorage') ||
  (process.env.NODE_ENV === 'local' && typeof window !== 'undefined' && window.localStorage);

/** Daily per-course enrollment totals, one document per course per calendar date. */
export const EnrollmentSnapshotRepository = {
  // Get every recorded snapshot (across all dates/courses)
  findAll: async () => {
    if (USE_LOCAL_STORAGE) {
      return LocalStorageEnrollmentSnapshotRepository.findAll();
    }
    const collection = getCollection('enrollmentSnapshots');
    const snapshot = await collection.get();
    return formatDocuments(snapshot.docs);
  },

  // Create or overwrite today's totals for a course (id is deterministic: `${date}_${courseKey}`)
  upsert: async (id, data) => {
    if (USE_LOCAL_STORAGE) {
      return LocalStorageEnrollmentSnapshotRepository.upsert(id, data);
    }
    const collection = getCollection('enrollmentSnapshots');
    await collection.doc(id).set(data, { merge: true });
    return { ...data, id };
  },
};
