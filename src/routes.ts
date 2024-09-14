import { FastifyInstance } from "fastify";
import {
  requestUpdateRequestBody,
  requestUpdateResponseBody,
  updateBatchRequestBody,
  updateBatchResponseBody,
} from "./types";
import {
  createUpdateSession,
  getPermittedChanges,
  getUpdateSession,
  applyUpdate,
  deleteUpdateSession,
} from "./storage";

const BATCH_SIZE: number = parseInt(process.env.BATCH_SIZE || "3"); // Limit for number of changes per session

export default async function routes(fastify: FastifyInstance) {
  // Request update - Endpoint to compare client manifest with server files
  fastify.post<{
    Body: requestUpdateRequestBody;
    Reply: requestUpdateResponseBody;
  }>("/request-update", async (request, reply) => {
    const { manifest } = request.body;
    fastify.log.info('Received request-update.');

    try {
      // Determine which changes are needed based on the client's manifest
      const permittedChanges = await getPermittedChanges(manifest);
      fastify.log.info(`Permitted changes identified: ${permittedChanges.length}`);

      if (permittedChanges.length === 0) {
        fastify.log.info('No changes required, sending empty update session list.');
        return reply.status(200).send({ updateSessions: [] });
      }

      // Split permitted changes into sessions if needed
      const updateSessions = [];
      for (let i = 0; i < permittedChanges.length; i += BATCH_SIZE) {
        const batch = permittedChanges.slice(i, i + BATCH_SIZE);
        const session = createUpdateSession(batch);
        updateSessions.push({id: session.id, permittedChanges: session.permittedChanges});
        fastify.log.info(`Created update session with ID: ${session.id} containing ${batch.length} changes.`);
      }

      fastify.log.info(`Total update sessions created: ${updateSessions.length}`);
      return reply.status(200).send({ updateSessions });
    } catch (error) {
      fastify.log.error(`Error during update request: ${error}`);
      return reply.status(500);
    }
  });

  // Update batch - Endpoint to apply updates from a session
  fastify.post<{
    Body: updateBatchRequestBody;
    Reply: updateBatchResponseBody;
  }>("/update-batch", async (request, reply) => {
    const { id, updates } = request.body;
    fastify.log.info(`Received update batch request for session ID: ${id} with ${updates.length} updates.`);

    // Retrieve the session by ID
    const session = getUpdateSession(id);
    if (!session) {
      fastify.log.warn(`Session not found for ID: ${id}`);
      return reply.status(400).send(
        updates.map((update) => ({
          path: update.path,
          status: "failure",
        }))
      );
    }
    fastify.log.info(`Session found: ${id}, applying updates.`);

    // Validate updates against permitted changes in the session
    const permittedPaths = new Set(session.permittedChanges.map((change) => change.path));
    fastify.log.info(`Permitted paths for session ${id}: ${Array.from(permittedPaths).join(', ')}`);

    // Apply updates and collect results
    const results = await Promise.all(
      updates.map(async (update) => {
        if (!permittedPaths.has(update.path)) {
          fastify.log.warn(`Update path not permitted: ${update.path}`);
          return { path: update.path, status: "failure" };
        }
        const result = await applyUpdate(update);
        fastify.log.info(`Applied update on ${update.path}, status: ${result.status}`);
        return result;
      })
    ) as updateBatchResponseBody;

    fastify.log.info(`Completed applying updates for session ${id}.`);
    deleteUpdateSession(id);
    return reply.status(200).send(results);
  });
}