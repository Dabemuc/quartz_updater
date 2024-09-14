import Fastify, { FastifyInstance } from 'fastify';
import routes from '../src/routes'; // Adjust this path based on your project structure
import { initializeManifestCache } from '../src/storage'; // Adjust this path based on your project structure
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Manifest } from '../src/types'; // Adjust this path based on your project structure

const CONTENT_DIR = path.join(__dirname, '../content'); // Adjust this path based on your project structure

const buildFastify = () => {
  const fastify = Fastify();
  fastify.register(routes);
  return fastify;
};

describe('POST /request-update', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = buildFastify();
    await initializeManifestCache(); // Ensure the manifest cache is initialized
    await fastify.listen({ port: 0 }); // Listen on an ephemeral port
  });

  afterAll(async () => {
    await fastify.close(); // Close the server after tests
  });

  beforeEach(async () => {
    // Ensure the content directory is clean before each test
    await fs.rmdir(CONTENT_DIR, { recursive: true });
    await fs.mkdir(CONTENT_DIR, { recursive: true });
  });

  it('should create update sessions based on the provided manifest', async () => {
    // Setup initial server content
    const filePath = path.join(CONTENT_DIR, 'test-file.md');
    const initialContent = 'Initial content';
    await fs.writeFile(filePath, initialContent, 'utf-8');

    // Calculate the hash of the initial content
    const hash = crypto.createHash('sha256').update(initialContent).digest('hex');

    // Define a manifest that reflects the current server state
    const manifest: Manifest = [
      { path: 'test-file.md', hash },
    ];

    // Simulate a client request with the manifest
    const response = await fastify.inject({
      method: 'POST',
      url: '/request-update',
      payload: { manifest },
    });

    // Parse and verify the response
    const { updateSessions } = JSON.parse(response.payload) as { updateSessions: any[] };
    
    expect(response.statusCode).toBe(200);
    expect(updateSessions).toBeDefined();
    expect(updateSessions.length).toBeGreaterThan(0); // Ensure at least one session is created

    // Optional: Add further assertions to verify the correctness of update sessions
    updateSessions.forEach(session => {
      expect(session).toHaveProperty('id');
      expect(session).toHaveProperty('permittedChanges');
    });
  });
});
