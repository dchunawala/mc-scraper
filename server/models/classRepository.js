import { getDb, getCollection, formatDocument, formatDocuments } from './index.js';
import { LocalStorageClassRepository } from './localStorageAdapter.js';

// Check if localStorage should be used
const USE_LOCAL_STORAGE = (process.env.NODE_ENV === 'localStorage') || 
  (process.env.NODE_ENV === 'local' && typeof window !== 'undefined' && window.localStorage);

// Repository for Class collection operations
export const ClassRepository = {
  // Get all classes
  findAll: async () => {
    if (USE_LOCAL_STORAGE) {
      return LocalStorageClassRepository.findAll();
    }
    const classesCollection = getCollection('classes');
    const snapshot = await classesCollection.get();
    return formatDocuments(snapshot.docs);
  },

  // Get classes by semester ID
  findBySemester: async (semesterId) => {
    try {
      if (USE_LOCAL_STORAGE) {
        return LocalStorageClassRepository.findBySemester(semesterId);
      }
      const classesCollection = getCollection('classes');
      const snapshot = await classesCollection.where('semesterId', '==', semesterId).get();
      return formatDocuments(snapshot.docs);
    } catch (error) {
      console.error(`Error finding classes for semester (${semesterId}):`, error);
      return [];
    }
  },

  // Get class by ID
  findById: async (id) => {
    try {
      if (USE_LOCAL_STORAGE) {
        return LocalStorageClassRepository.findById(id);
      }
      const classesCollection = getCollection('classes');
      const doc = await classesCollection.doc(id).get();
      
      if (!doc.exists) {
        return null;
      }
      
      return formatDocument(doc);
    } catch (error) {
      console.error(`Error finding class by ID (${id}):`, error);
      return null;
    }
  },

  // Create a new class
  create: async (classData) => {
    // Convert studentCount to number if it's a string
    if (classData.studentCount && typeof classData.studentCount === 'string') {
      classData.studentCount = parseInt(classData.studentCount, 10);
    }
    
    // Ensure days is an array
    if (classData.days && !Array.isArray(classData.days)) {
      classData.days = [classData.days];
    }
    
    // Generate a human-readable, deterministic ID for the class.
    // Include course number + section (or the scraper's stable section id) so
    // different sections of the same course code never collide.
    const courseCode = classData.courseCode.replace(/\s+/g, '');
    const semesterPart = classData.semesterId.replace(/\-/g, '');
    const uniquePart = classData.scrapedSectionId
      || [classData.courseNumber, classData.section].filter(Boolean).join('-').replace(/\s+/g, '')
      || Date.now().toString().slice(-6);
    const readableId = `CLASS-${semesterPart}-${courseCode}-${uniquePart}`;
    
    if (USE_LOCAL_STORAGE) {
      return LocalStorageClassRepository.create(classData);
    }
    {
      const classesCollection = getCollection('classes');
      
      try {
        // Check if a class with this ID already exists
        const existingDoc = await classesCollection.doc(readableId).get();
        if (existingDoc.exists) {
          // If the same course is taught multiple times in the same semester,
          // add a section number to make the ID unique
          const snapshot = await classesCollection
            .where('courseCode', '==', courseCode)
            .where('semesterId', '==', classData.semesterId)
            .get();
          
          const sectionCount = snapshot.docs.length + 1;
          const uniqueId = `${readableId}-SEC${sectionCount}`;
          
          // Preserve the user's section input instead of auto-incrementing
          const documentToInsert = {
            ...classData,
            customId: uniqueId
            // Remove 'section: sectionCount' to preserve user's section input
          };
          
          await classesCollection.doc(uniqueId).set(documentToInsert);
          // Return user's original section value instead of sectionCount
          return { ...classData, id: uniqueId, customId: uniqueId };
        }
        
        // Use the readable ID as the document ID
        // Preserve user's entered section instead of defaulting to 1
        const documentToInsert = {
          ...classData,
          customId: readableId
          // Remove 'section: 1' to preserve user's original section input
        };
        
        await classesCollection.doc(readableId).set(documentToInsert);
        // Return user's original section value instead of hardcoded 1
        return { ...classData, id: readableId, customId: readableId };
      } catch (error) {
        // If there's any other error, add a timestamp to make ID unique
        const uniqueId = `${readableId}-${Date.now().toString().slice(-4)}`;
        // Preserve user's entered section even in error case
        const documentToInsert = {
          ...classData,
          customId: uniqueId
          // Remove 'section: 1' to preserve user's original section input
        };
        
        await classesCollection.doc(uniqueId).set(documentToInsert);
        // Return user's original section value in error case too
        return { ...classData, id: uniqueId, customId: uniqueId };
      }
    }
  },

  // Update a class
  update: async (id, classData) => {
    // Convert studentCount to number if it's a string
    if (classData.studentCount && typeof classData.studentCount === 'string') {
      classData.studentCount = parseInt(classData.studentCount, 10);
    }
    
    // Ensure days is an array
    if (classData.days && !Array.isArray(classData.days)) {
      classData.days = [classData.days];
    }
    
    if (USE_LOCAL_STORAGE) {
      return LocalStorageClassRepository.update(id, classData);
    }
    const classesCollection = getCollection('classes');
    const docRef = classesCollection.doc(id);
    
    // Check if document exists
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error('Class not found');
    }
    
    await docRef.update(classData);
    return { ...classData, id };
  },

  // Delete a class
  delete: async (id) => {
    if (USE_LOCAL_STORAGE) {
      return LocalStorageClassRepository.delete(id);
    }
    const classesCollection = getCollection('classes');
    const docRef = classesCollection.doc(id);
    
    // Check if document exists
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error('Class not found');
    }
    
    await docRef.delete();
    return { id };
  },

  // Delete classes by semester ID
  deleteBySemester: async (semesterId) => {
    try {
      const classesCollection = getCollection('classes');
      
      // Firestore doesn't have a direct deleteMany equivalent
      // We need to get all matching documents and delete them one by one
      const snapshot = await classesCollection.where('semesterId', '==', semesterId).get();
      
      // Use a batch write for better performance
      const db = getDb();
      const batch = db.batch();
      
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      return { semesterId };
    } catch (error) {
      console.error(`Error deleting classes for semester (${semesterId}):`, error);
      throw error;
    }
  },

  // Check if any classes are using a specific room
  findByRoomId: async (roomId) => {
    try {
      if (USE_LOCAL_STORAGE) {
        return LocalStorageClassRepository.findByRoomId(roomId);
      }
      const classesCollection = getCollection('classes');
      const snapshot = await classesCollection.where('roomId', '==', roomId).limit(1).get();
      
      if (snapshot.empty) {
        return null;
      }
      
      return formatDocument(snapshot.docs[0]);
    } catch (error) {
      console.error(`Error finding classes for room (${roomId}):`, error);
      return null;
    }
  }
};
