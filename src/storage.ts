import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { updateSession, Manifest, Update, PermittedChange } from './types';

// Directory where the Markdown files are stored
const CONTENT_DIR = path.join(__dirname, '../content');

// Timeout for update sessions in milliseconds
const UPDATE_SESSION_TIMEOUT = parseInt(process.env.UPDATE_SESSION_TIMEOUT || '60000');

// In-memory storage for the manifest and update sessions
let manifestCache: Manifest = []; // Stores the current manifest of all files
const sessionStorage: Map<string, updateSession> = new Map(); // Stores update sessions by session ID

// Generate a unique session ID
const generateSessionId = (): string => `session_${Math.random().toString(36).substring(2, 15)}`;

// Helper function to calculate the hash of file content
const hashContent = (content: string): string =>
  crypto.createHash('sha256').update(content).digest('hex');

// Helper function to read a file's content and hash
const readFileAndHash = async (filePath: string): Promise<{ hash: string; content: string }> => {
  console.log(`Reading and hashing file: ${filePath}`);
  const content = await fs.readFile(filePath, 'utf-8');
  const hash = hashContent(content);
  console.log(`File read successfully: ${filePath}, Hash: ${hash}`);
  return { content, hash };
};

// Initialize the manifest cache by reading all files from the content directory
export const initializeManifestCache = async (): Promise<void> => {
  console.log('Initializing manifest cache...');
  try {
    const files = await fs.readdir(CONTENT_DIR);
    manifestCache = await Promise.all(
      files.map(async (file) => {
        const fullPath = path.join(CONTENT_DIR, file);
        const { hash } = await readFileAndHash(fullPath);
        return { path: file, hash };
      })
    );
    console.log('Manifest cache initialized successfully with files:', manifestCache);
  } catch (error) {
    console.error('Error initializing manifest cache:', error);
  }
};
// Compare client manifest with server manifest and determine permitted changes
export const getPermittedChanges = async (clientManifest: Manifest): Promise<PermittedChange[]> => {
  console.log('Comparing client manifest with server manifest...');
  const changes: PermittedChange[] = [];

  // Convert manifestCache and clientManifest to maps for easier lookup
  const serverManifestMap = new Map<string, string>(manifestCache.map(file => [file.path, file.hash]));
  const clientManifestMap = new Map<string, string>(clientManifest.map(file => [file.path, file.hash]));

  // Identify updates, creations and deletions
  for (const [path, clientHash] of clientManifestMap.entries()) {
    const serverHash = serverManifestMap.get(path);
    if (serverHash) {
      // If file exists in server but hashes are different, it's an update
      if (serverHash !== clientHash) {
        changes.push({ type: 'update', path });
      }
    } else {
      // File does not exist on the server but is present in the client manifest
      changes.push({ type: 'create', path });
    }
  }

  // Identify deletions
  for (const [path, serverHash] of serverManifestMap.entries()) {
    if (!clientManifestMap.has(path)) {
      // File exists on the server but is missing in the client manifest
      changes.push({ type: 'delete', path });
    }
  }

  console.log('Permitted changes determined:', changes);
  return changes;
};

// Create and store update sessions
export const createUpdateSession = (permittedChanges: PermittedChange[]): updateSession => {
  const sessionId = generateSessionId();
  const timeout= setTimeout(() => {
    console.log(`Update session timed out: ${sessionId}`);
    sessionStorage.delete(sessionId);
  }, UPDATE_SESSION_TIMEOUT);
  const session: updateSession = { id: sessionId, permittedChanges, timeout};
  sessionStorage.set(sessionId, session);
  console.log(`Created update session: ${sessionId} with changes:`, permittedChanges);
  return session;
};

// Retrieve update session by ID
export const getUpdateSession = (id: string): updateSession | undefined => {
  console.log(`Retrieving update session: ${id}`);
  const session = sessionStorage.get(id);
  if (session) {
    console.log(`Update session found: ${id}`);
  } else {
    console.warn(`Update session not found: ${id}`);
  }
  return session;
};

// Delete update session by ID
export const deleteUpdateSession = (id: string): void => {
  console.log(`Deleting update session: ${id}`);
  const session = sessionStorage.get(id);
  if (session) {
    clearTimeout(session.timeout);
    sessionStorage.delete(id);
    console.log(`Update session deleted: ${id}`);
  } else {
    console.warn(`Update session not found for deletion: ${id}`);
  }
};

// Perform the actual file update and update the manifest cache accordingly
export const applyUpdate = async (
  update: Update
): Promise<{ path: string; status: 'success' | 'failure' }> => {
  const filePath = path.join(CONTENT_DIR, update.path);
  console.log(`Applying update: ${update.type} on file: ${update.path}`);

  try {
    switch (update.type) {
      case 'create':
      case 'update':
        // Create or update the file
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, update.content, 'utf-8');
        const newHash = hashContent(update.content);
        console.log(`File ${update.type}d successfully: ${update.path}, New Hash: ${newHash}`);

        // Update the manifest cache
        const existingFileIndex = manifestCache.findIndex((f) => f.path === update.path);
        if (existingFileIndex > -1) {
          manifestCache[existingFileIndex].hash = newHash; // Update existing hash
        } else {
          manifestCache.push({ path: update.path, hash: newHash }); // Add new file
        }

        return { path: update.path, status: 'success' };

      case 'delete':
        // Delete the file if it exists
        await fs.unlink(filePath);
        console.log(`File deleted successfully: ${update.path}`);

        // Update the manifest cache
        manifestCache = manifestCache.filter((f) => f.path !== update.path);
        return { path: update.path, status: 'success' };

      default:
        console.error(`Invalid update type: ${update.type}`);
        return { path: update.path, status: 'failure' };
    }
  } catch (error) {
    console.error(`Error applying update to ${update.path}:`, error);
    return { path: update.path, status: 'failure' };
  }
};