import { getDb, getCollection, formatDocument, formatDocuments } from './index.js';
import { LocalStorageRoomRepository } from './localStorageAdapter.js';

// Check if localStorage should be used
const USE_LOCAL_STORAGE = (process.env.NODE_ENV === 'localStorage') || 
  (process.env.NODE_ENV === 'local' && typeof window !== 'undefined' && window.localStorage);

// Repository for Room collection operations
export const RoomRepository = {
  // Get all rooms
  findAll: async () => {
    if (USE_LOCAL_STORAGE) {
      return LocalStorageRoomRepository.findAll();
    }
    const roomsCollection = getCollection('rooms');
    const snapshot = await roomsCollection.get();
    return formatDocuments(snapshot.docs);
  },

  // Get rooms by semester ID
  findBySemester: async (semesterId) => {
    try {
      if (USE_LOCAL_STORAGE) {
        return LocalStorageRoomRepository.findBySemester(semesterId);
      }
      const roomsCollection = getCollection('rooms');
      const snapshot = await roomsCollection.where('semesterId', '==', semesterId).get();
      return formatDocuments(snapshot.docs);
    } catch (error) {
      console.error(`Error finding rooms for semester (${semesterId}):`, error);
      return [];
    }
  },

  // Get room by ID
  findById: async (id) => {
    try {
      if (USE_LOCAL_STORAGE) {
        return LocalStorageRoomRepository.findById(id);
      }
      const roomsCollection = getCollection('rooms');
      const doc = await roomsCollection.doc(id).get();
      
      if (!doc.exists) {
        return null;
      }
      
      return formatDocument(doc);
    } catch (error) {
      console.error(`Error finding room by ID (${id}):`, error);
      return null;
    }
  },

  // Create a new room
  create: async (roomData) => {
    try {
      // Ensure capacity is stored as a number
      if (roomData.capacity && typeof roomData.capacity === 'string') {
        roomData.capacity = parseInt(roomData.capacity, 10);
      }
      
      // Generate a human-readable ID for the room
      // Format: ROOM-[SemesterID]-[RoomNumber] (e.g., "ROOM-SPRING2025-101")
      const roomNumber = roomData.roomNumber.replace(/\s+/g, '');
      const semesterPart = roomData.semesterId.replace(/\-/g, '');
      const readableId = `ROOM-${semesterPart}-${roomNumber}`;
      
      if (USE_LOCAL_STORAGE) {
        return LocalStorageRoomRepository.create(roomData);
      }
      const roomsCollection = getCollection('rooms');
      
      try {
        // Check if a room with this ID already exists
        const existingDoc = await roomsCollection.doc(readableId).get();
        if (existingDoc.exists) {
          throw new Error(`A room with ID ${readableId} already exists`);
        }
        
        // Use the readable ID as the document ID
        const documentToInsert = {
          ...roomData,
          customId: readableId // Store the readable ID as a field too for querying
        };
        
        await roomsCollection.doc(readableId).set(documentToInsert);
        return { ...roomData, id: readableId, customId: readableId };
      } catch (error) {
        // If ID already exists but it's a different room number in the same semester
        // Generate a unique variant of the ID
        if (error.message.includes('already exists')) {
          const uniqueId = `${readableId}-${Date.now().toString().slice(-4)}`;
          const documentToInsert = {
            ...roomData,
            customId: uniqueId
          };
          
          await roomsCollection.doc(uniqueId).set(documentToInsert);
          return { ...roomData, id: uniqueId, customId: uniqueId };
        }
        throw error;
      }
    } catch (error) {
      console.error(`Error creating room:`, error);
      throw error;
    }
  },

  // Update a room
  update: async (id, roomData) => {
    try {
      // Ensure capacity is stored as a number if provided
      if (roomData.capacity && typeof roomData.capacity === 'string') {
        roomData.capacity = parseInt(roomData.capacity, 10);
      }
      
      if (USE_LOCAL_STORAGE) {
        return LocalStorageRoomRepository.update(id, roomData);
      }
      const roomsCollection = getCollection('rooms');
      const docRef = roomsCollection.doc(id);
      
      // Check if document exists
      const doc = await docRef.get();
      if (!doc.exists) {
        throw new Error('Room not found');
      }
      
      await docRef.update(roomData);
      return { ...roomData, id };
    } catch (error) {
      console.error(`Error updating room (${id}):`, error);
      throw error;
    }
  },

  // Delete a room
  delete: async (id) => {
    try {
      if (USE_LOCAL_STORAGE) {
        return LocalStorageRoomRepository.delete(id);
      }
      const db = getDb();
      const classesCollection = getCollection('classes');
      
      // Check if any classes are using this room
      const snapshot = await classesCollection.where('roomId', '==', id).limit(1).get();
      if (!snapshot.empty) {
        throw new Error('Cannot delete room - there are classes assigned to it');
      }
      
      const roomsCollection = getCollection('rooms');
      const docRef = roomsCollection.doc(id);
      
      // Check if document exists
      const doc = await docRef.get();
      if (!doc.exists) {
        throw new Error('Room not found');
      }
      
      await docRef.delete();
      return { id };
    } catch (error) {
      console.error(`Error deleting room (${id}):`, error);
      throw error;
    }
  }
};
