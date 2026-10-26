/**
 * Local Storage Adapter for ClassRoom Scheduler
 * 
 * This module provides a localStorage-based implementation of the data repositories
 * for local development without requiring Firestore or MongoDB.
 */

// In-memory storage to simulate localStorage on the server side
let memoryStorage = {
  semesters: {},
  rooms: {},
  classes: {}
};
let snapshotWriter = null;

// Helper to generate a unique ID (similar to MongoDB ObjectId or Firestore ID)
const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
};

// Initialize localStorage if running in browser environment
const initLocalStorage = () => {
  if (typeof window !== 'undefined' && window.localStorage) {
    // Initialize collections if they don't exist
    if (!localStorage.getItem('semesters')) {
      localStorage.setItem('semesters', JSON.stringify({}));
    }
    if (!localStorage.getItem('rooms')) {
      localStorage.setItem('rooms', JSON.stringify({}));
    }
    if (!localStorage.getItem('classes')) {
      localStorage.setItem('classes', JSON.stringify({}));
    }
    
    // Load data from localStorage into memory
    try {
      memoryStorage.semesters = JSON.parse(localStorage.getItem('semesters') || '{}');
      memoryStorage.rooms = JSON.parse(localStorage.getItem('rooms') || '{}');
      memoryStorage.classes = JSON.parse(localStorage.getItem('classes') || '{}');
    } catch (error) {
      console.error('Error parsing localStorage data:', error);
      // Reset to empty if parsing fails
      memoryStorage = {
        semesters: {},
        rooms: {},
        classes: {}
      };
    }
  }
};

// Save data to localStorage (if in browser environment)
const saveToLocalStorage = (collection, data) => {
  memoryStorage[collection] = data;
  
  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.setItem(collection, JSON.stringify(data));
  }
  snapshotWriter?.(memoryStorage);
};

export const setSnapshotWriter = (writer) => {
  snapshotWriter = writer;
};

export const seedLocalStorage = (snapshot = {}) => {
  const nextStorage = { ...memoryStorage };
  for (const [collectionName, records] of Object.entries(snapshot)) {
    if (!Array.isArray(records)) continue;
    nextStorage[collectionName] = Object.fromEntries(
      records.filter((record) => record?.id).map((record) => {
        const { id, ...data } = record;
        return [id, data];
      }),
    );
  }
  memoryStorage = nextStorage;
};

// Generic repository factory for any collection
const createLocalStorageRepository = (collectionName) => {
  // Initialize localStorage on first use
  initLocalStorage();
  
  return {
    // Find all documents in a collection
    findAll: async () => {
      const collection = memoryStorage[collectionName] || {};
      return Object.keys(collection).map(id => ({
        id,
        ...collection[id]
      }));
    },
    
    // Find document by ID
    findById: async (id) => {
      const collection = memoryStorage[collectionName] || {};
      if (!collection[id]) return null;
      
      return {
        id,
        ...collection[id]
      };
    },
    
    // Find documents by a field value (e.g., semesterId)
    findByField: async (field, value) => {
      const collection = memoryStorage[collectionName] || {};
      
      return Object.keys(collection)
        .filter(id => collection[id][field] === value)
        .map(id => ({
          id,
          ...collection[id]
        }));
    },
    
    // Create a new document
    create: async (data) => {
      const id = generateId();
      const collection = memoryStorage[collectionName] || {};
      
      collection[id] = { ...data, createdAt: new Date().toISOString() };
      saveToLocalStorage(collectionName, collection);
      
      return {
        id,
        ...collection[id]
      };
    },
    
    // Update an existing document
    update: async (id, data) => {
      const collection = memoryStorage[collectionName] || {};
      if (!collection[id]) {
        throw new Error(`Document with ID ${id} not found in ${collectionName}`);
      }
      
      collection[id] = {
        ...collection[id],
        ...data,
        updatedAt: new Date().toISOString()
      };
      
      saveToLocalStorage(collectionName, collection);
      
      return {
        id,
        ...collection[id]
      };
    },
    
    // Delete a document
    delete: async (id) => {
      const collection = memoryStorage[collectionName] || {};
      if (!collection[id]) {
        throw new Error(`Document with ID ${id} not found in ${collectionName}`);
      }
      
      delete collection[id];
      saveToLocalStorage(collectionName, collection);
      
      return { id };
    },
    
    // Delete all documents in a collection
    deleteAll: async () => {
      saveToLocalStorage(collectionName, {});
      return { count: 0 };
    }
  };
};

// Create repositories for each collection
export const LocalStorageSemesterRepository = createLocalStorageRepository('semesters');
export const LocalStorageRoomRepository = createLocalStorageRepository('rooms');
export const LocalStorageClassRepository = createLocalStorageRepository('classes');
export const LocalStoragePlannerClassRepository = createLocalStorageRepository('plannerClasses');
export const LocalStorageEventRepository = createLocalStorageRepository('events');
export const LocalStorageEnrollmentSnapshotRepository = createLocalStorageRepository('enrollmentSnapshots');
export const LocalStorageStaShiftRepository = createLocalStorageRepository('staShifts');
export const LocalStorageLostFoundRepository = createLocalStorageRepository('lostFound');
export const LocalStorageAdjunctAssignmentRepository = createLocalStorageRepository('adjunctAssignments');
export const LocalStorageFacultyRepository = createLocalStorageRepository('faculty');
export const LocalStorageSeatAlertRepository = createLocalStorageRepository('seatAlerts');

// Add specific methods for each repository

// Semester-specific methods
LocalStorageSemesterRepository.findBySemester = async (semesterId) => {
  return LocalStorageSemesterRepository.findByField('semesterId', semesterId);
};

// Room-specific methods
LocalStorageRoomRepository.findBySemester = async (semesterId) => {
  return LocalStorageRoomRepository.findByField('semesterId', semesterId);
};

const localStorageRoomDelete = LocalStorageRoomRepository.delete;
LocalStorageRoomRepository.delete = async (id) => {
  const assignedClasses = await LocalStorageClassRepository.findByField('roomId', id);
  if (assignedClasses.length > 0) {
    throw new Error('Cannot delete room - there are classes assigned to it');
  }
  return localStorageRoomDelete(id);
};

// Class-specific methods
LocalStorageClassRepository.findBySemester = async (semesterId) => {
  return LocalStorageClassRepository.findByField('semesterId', semesterId);
};

LocalStorageClassRepository.findByRoom = async (roomId) => {
  return LocalStorageClassRepository.findByField('roomId', roomId);
};

// Planner class-specific methods
LocalStoragePlannerClassRepository.findBySemester = async (semesterId) => {
  return LocalStoragePlannerClassRepository.findByField('semesterId', semesterId);
};

// Event-specific methods
LocalStorageEventRepository.findBySemester = async (semesterId) => {
  return LocalStorageEventRepository.findByField('semesterId', semesterId);
};

// STA shift-specific methods
LocalStorageStaShiftRepository.findBySemester = async (semesterId) => {
  return LocalStorageStaShiftRepository.findByField('semesterId', semesterId);
};

LocalStorageLostFoundRepository.findBySemester = async (semesterId) => {
  return LocalStorageLostFoundRepository.findByField('semesterId', semesterId);
};

LocalStorageAdjunctAssignmentRepository.findBySemester = async (semesterId) => {
  return LocalStorageAdjunctAssignmentRepository.findByField('semesterId', semesterId);
};

LocalStorageFacultyRepository.findBySemester = async (semesterId) => {
  return LocalStorageFacultyRepository.findByField('semesterId', semesterId);
};

LocalStorageSeatAlertRepository.findBySemester = async (semesterId) => {
  return LocalStorageSeatAlertRepository.findByField('semesterId', semesterId);
};

// Seat alerts use the class id as their document id.
LocalStorageSeatAlertRepository.upsert = async (id, data) => {
  const collection = memoryStorage['seatAlerts'] || {};
  collection[id] = { ...collection[id], ...data };
  saveToLocalStorage('seatAlerts', collection);
  return { id, ...collection[id] };
};

// Enrollment snapshot-specific methods (deterministic id: `${date}_${courseKey}`)
LocalStorageEnrollmentSnapshotRepository.upsert = async (id, data) => {
  const collection = memoryStorage['enrollmentSnapshots'] || {};
  collection[id] = { ...collection[id], ...data };
  saveToLocalStorage('enrollmentSnapshots', collection);
  return { id, ...collection[id] };
};

// Export a function to check if localStorage is available
export const isLocalStorageAvailable = () => {
  if (typeof window === 'undefined') return false;
  
  try {
    const testKey = '__test__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
};