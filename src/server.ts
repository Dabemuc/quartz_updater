import Fastify from 'fastify';
import routes from './routes';
import { initializeManifestCache } from './storage';
import { promises as fs } from 'fs';
import path from 'path';

// Read environment variables
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, '../content');

// Create a Fastify instance
const fastify = Fastify({
  logger: true, // Enables logging for requests
});

// Register routes
fastify.register(routes);

// Start the server
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server is running at http://localhost:3000');
    await fs.mkdir(CONTENT_DIR, { recursive: true });
    initializeManifestCache();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
