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
  getAllUpdateSessions,
} from "./storage";
import { execSync } from "child_process";

const BATCH_SIZE: number = parseInt(process.env.BATCH_SIZE || "10"); // Limit for number of changes per session

export default async function routes(fastify: FastifyInstance) {
  // Request update - Endpoint to compare client manifest with server files
  fastify.post<{
    Body: requestUpdateRequestBody;
    Reply: requestUpdateResponseBody;
  }>("/quartz_updater/request-update", async (request, reply) => {
    console.log("Received request-update.");

    // Reject if ongoing update session. Simple way to avoid problems cause no multiple clients expected
    if (getAllUpdateSessions().length > 0) {
      console.warn("Update session in progress, rejecting request.");
      return reply.status(409);
    }

    // Extract the client's manifest from the request
    const { manifest } = request.body;

    // Validate the client's manifest
    if (!manifest) {
      console.error("Client manifest not provided.");
      return reply.status(400);
    }

    try {
      // Determine which changes are needed based on the client's manifest
      const permittedChanges = await getPermittedChanges(manifest);
      console.info(`Permitted changes identified: ${permittedChanges.length}`);

      if (permittedChanges.length === 0) {
        console.info("No changes required, sending empty update session list.");
        return reply.status(200).send({ updateSessions: [] });
      }

      // Split permitted changes into sessions if needed
      const updateSessions = [];
      for (let i = 0; i < permittedChanges.length; i += BATCH_SIZE) {
        const batch = permittedChanges.slice(i, i + BATCH_SIZE);
        const session = createUpdateSession(batch);
        updateSessions.push({
          id: session.id,
          permittedChanges: session.permittedChanges,
        });
        console.info(
          `Created update session with ID: ${session.id} containing ${batch.length} changes.`
        );
      }

      console.info(`Total update sessions created: ${updateSessions.length}`);
      return reply.status(200).send({ updateSessions });
    } catch (error) {
      console.error(`Error during update request: ${error}`);
      return reply.status(500);
    }
  });

  // Update batch - Endpoint to apply updates from a session
  fastify.post<{
    Body: updateBatchRequestBody;
    Reply: updateBatchResponseBody;
  }>("/quartz_updater/update-batch", async (request, reply) => {
    const { id, updates } = request.body;
    console.info(
      `Received update batch request for session ID: ${id} with ${updates.length} updates.`
    );

    // Retrieve the session by ID
    const session = getUpdateSession(id);
    if (!session) {
      console.warn(`Session not found for ID: ${id}`);
      return reply.status(400).send(
        updates.map((update) => ({
          path: update.path,
          status: "failure",
        }))
      );
    }
    console.info(`Session found: ${id}, applying updates.`);

    // Validate updates against permitted changes in the session
    const permittedPaths = new Set(
      session.permittedChanges.map((change) => change.path)
    );
    console.info(
      `Permitted paths for session ${id}: ${Array.from(permittedPaths).join(
        ", "
      )}`
    );

    // Apply updates and collect results
    const results = (await Promise.all(
      updates.map(async (update) => {
        if (!permittedPaths.has(update.path)) {
          console.warn(`Update path not permitted: ${update.path}`);
          return { path: update.path, status: "failure" };
        }
        const result = await applyUpdate(update);
        console.info(
          `Applied update on ${update.path}, status: ${result.status}`
        );
        return result;
      })
    )) as updateBatchResponseBody;

    console.info(`Completed applying updates for session ${id}.`);
    deleteUpdateSession(id);
    return reply.status(200).send(results);
  });

  fastify.post("/quartz_updater/rebuild-quartz", async (_request, reply) => {
    console.log("Received rebuild-quartz request.");

    const serviceName = process.env.QUARTZ_SERIVCE_NAME;
    if (!serviceName) {
      console.error("QUARTZ_SERVICE_NAME environment variable not set.");
      return reply.status(500);
    }

    // Get running services from docker_manager systemd service on host
    const servicesResponse = await fetch("http://172.17.0.1:5000/services")
    const servicesJson = await servicesResponse.json()
    const runningServices: string[] | undefined = servicesJson.running_services || undefined
    if (!runningServices) {
      console.error("Failed to get running services from docker_manager.")
      return reply.status(500)
    }
    
    // POST endpoint to rebuild quartz
    try {
      const rebuildReply = await fetch(`http://172.17.0.1:5000/rebuild?service=${serviceName}`, {
        method: "POST",
      });
      const rebuildReplyJson = await rebuildReply.json();
      if (rebuildReply.status === 200) {
        console.info(`Rebuild request successful: ${rebuildReplyJson}`);
        return reply.status(200).send(rebuildReplyJson);
      } else {
        console.error(`Rebuild request failed: ${rebuildReplyJson}`);
        return reply.status(500).send(rebuildReplyJson);
      }
    } catch (error) {
      console.error(`Error rebuilding quartz: ${error}`);
      return reply.status(500).send(error);
    }
  });
}
