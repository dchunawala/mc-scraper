import { Firestore } from '@google-cloud/firestore';
import dotenv from 'dotenv';
import { isLocalStorageAvailable } from './localStorageAdapter.js';
import * as fs from 'fs';

dotenv.config();

// Database Configuration
// Default to 'firestore' instead of 'local' to ensure Firebase is used when running locally
const NODE_ENV = process.env.NODE_ENV || 'firestore';
const SHARED_COLLECTION_PREFIX = 'classroomMgmt';

// Check if localStorage should be used (when running locally)
const USE_LOCAL_STORAGE = NODE_ENV === 'localStorage' || (NODE_ENV === 'local' && isLocalStorageAvailable());

let firestoreDb;

// Initialize Firestore client
function initFirestore() {
  console.log('Initializing Firestore client...');
  
  try {
    // Check if project ID is provided
    const projectId = process.env.FIRESTORE_PROJECT_ID;
    if (!projectId) {
      throw new Error('FIRESTORE_PROJECT_ID environment variable is required for Firestore connection');
    }
    console.log(`Using project ID: ${projectId}`);
    
    // Get the credentials path from environment variable
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialsPath) {
      console.log('Warning: GOOGLE_APPLICATION_CREDENTIALS not set. Using application default credentials.');
    } else {
      console.log(`Using credentials path: ${credentialsPath}`);
      // Check if the file exists
      if (fs.existsSync(credentialsPath)) {
        console.log('✅ Service account key file found');
        
        // Log a portion of the file content to verify it's valid JSON
        try {
          const keyFile = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
          console.log(`Service account details - Project ID: ${keyFile.project_id}, Email: ${keyFile.client_email}`);
        } catch (e) {
          console.error('❌ Error parsing service account key file:', e.message);
        }
      } else {
        console.error(`❌ Service account key file not found at: ${credentialsPath}`);
      }
    }
    
    // Initialize Firestore with explicit credentials path
    const options = { projectId };
    if (credentialsPath) {
      options.keyFilename = credentialsPath; // Explicitly pass the keyFilename
    }
    
    console.log('Creating Firestore client with options:', JSON.stringify(options, null, 2));
    firestoreDb = new Firestore(options);
    
    console.log(`Connected to Firestore successfully (Project: ${projectId})`);
    global.dbConnectionSource = 'firestore';
    
    return firestoreDb;
  } catch (error) {
    console.error('Error initializing Firestore:', error);
    throw error;
  }
}

// Main database connection function
export async function connectToDatabase() {
  console.log(`Database environment: ${NODE_ENV}`);

  // File snapshot mode needs no remote client and no credentials.
  if (process.env.DATA_SOURCE === 'file') {
    console.log('Using local file snapshot (server/data/mcc-snapshot.json) for data persistence');
    global.dbConnectionSource = 'file';
    return { type: 'file' };
  }

  if (USE_LOCAL_STORAGE) {
    console.log('Using localStorage for data persistence');
    return { type: 'localStorage' };
  }
  return initFirestore();
}

// Get database instance
export function getDb() {
  if (USE_LOCAL_STORAGE) {
    // For localStorage, we don't need a database instance
    return { type: 'localStorage' };
  }
  if (!firestoreDb) {
    throw new Error('Firestore not connected. Call connectToDatabase first.');
  }
  return firestoreDb;
}

// Get collection with proper prefix for Firestore
export function getCollection(collectionName) {
  if (USE_LOCAL_STORAGE) {
    // For localStorage, we'll handle collections in the repository
    return { name: collectionName, type: 'localStorage' };
  }
  return firestoreDb.collection(`${SHARED_COLLECTION_PREFIX}_${collectionName}`);
}

// Close database connection
export async function closeConnection() {
  if (firestoreDb) {
    // Firestore client doesn't need explicit closing
    console.log('Firestore connection resources released');
  }
}

// Helper function to format document from either Firestore or localStorage
export function formatDocument(doc) {
  if (!doc) return null;
  
  if (USE_LOCAL_STORAGE) {
    // For localStorage, documents are already formatted correctly
    return doc;
  }
  // For Firestore documents
  const data = doc.data ? doc.data() : doc;
  return {
    id: doc.id || doc.name,
    ...data
  };
}

// Helper function to format an array of documents
export function formatDocuments(docs) {
  return docs.map(formatDocument);
}

// Helper function to create a query filter for Firestore
export function createFilter(field, value) {
  return [field, '==', value];
}

