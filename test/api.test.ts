import Fastify, { FastifyInstance } from "fastify";
import routes from "../src/routes";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { Manifest, PermittedChange, requestUpdateRequestBody, Update, updateBatchRequestBody, updateSession } from "../src/types";
import { initializeManifestCache } from "../src/storage";
import util from "util";

const CONTENT_DIR = path.join(__dirname, "../content");

const buildFastify = () => {
  const fastify = Fastify();
  fastify.register(routes);
  return fastify;
};

describe("Test the api roundtrip", () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = buildFastify();
    await fs.mkdir(CONTENT_DIR, { recursive: true }); // Create the content directory
    await fastify.listen({ port: 0 }); // Listen on an ephemeral port

    // Set environment variables
    process.env.CONTENT_DIR = CONTENT_DIR;
    process.env.UPDATE_SESSION_TIMEOUT = "60000";
    process.env.BATCH_SIZE = "3";
  });

  afterAll(async () => {
    await fs.rm(CONTENT_DIR, { recursive: true }); // Clean up the content directory
    await fastify.close(); // Close the server after tests
  });

  beforeEach(async () => {
    // Ensure the content directory is clean before each test
    await fs.rm(CONTENT_DIR, { recursive: true });
    await fs.mkdir(CONTENT_DIR, { recursive: true });
    console.log("Content directory prepped");
  });

  it("should create update sessions based on the provided manifest and then perform the correct changes", async () => {
    // Setup initial server content
    const filePathUnchanged = path.join(CONTENT_DIR, "test-file-unchanged.md");
    const initialContentUnchanged = "Initial content unchanged";
    await fs.writeFile(filePathUnchanged, initialContentUnchanged, "utf-8");

    const filePathMoved = path.join(CONTENT_DIR, "test-file-moved.md");
    const initialContentMoved = "Initial content moved";
    await fs.writeFile(filePathMoved, initialContentMoved, "utf-8");

    const filePathChanged = path.join(CONTENT_DIR, "test-file-changed.md");
    const initialContentChanged = "Initial content changed";
    await fs.writeFile(filePathChanged, initialContentChanged, "utf-8");

    const filePathMovedAndChanged = path.join(CONTENT_DIR, "test-file-moved-and-changed.md");
    const initialContentMovedAndChanged = "Initial content moved and changed";
    await fs.writeFile(filePathMovedAndChanged, initialContentMovedAndChanged, "utf-8");

    const filePathDeleted = path.join(CONTENT_DIR, "test-file-deleted.md");
    const initialContentDeleted = "Initial content deleted";
    await fs.writeFile(filePathDeleted, initialContentDeleted, "utf-8");

    // initialize server manifest cache
    await initializeManifestCache();

    // Calculate the hashes of the initial content
    const hashUnchanged = crypto
      .createHash("sha256")
      .update(initialContentUnchanged)
      .digest("hex");
    const hashMoved = crypto
      .createHash("sha256")
      .update(initialContentMoved)
      .digest("hex");
    const hashChanged = crypto
      .createHash("sha256")
      .update(initialContentChanged)
      .digest("hex");
    const hashMovedAndChanged = crypto
      .createHash("sha256")
      .update(initialContentMovedAndChanged)
      .digest("hex");
    const hashDeleted = crypto
      .createHash("sha256")
      .update(initialContentDeleted)
      .digest("hex");

    // Define a manifest that reflects the current server state
    const manifest: Manifest = [
      { path: "test-file-unchanged.md", hash: hashUnchanged },
      { path: "test-file-moved.md", hash: hashMoved },
      { path: "test-file-changed.md", hash: hashChanged },
      { path: "test-file-moved-and-changed.md", hash: hashMovedAndChanged },
      { path: "test-file-deleted.md", hash: hashDeleted },
    ];

    // Define a manifest that differs from the server state
    const clientManifest: Manifest = [
      { path: "test-file-unchanged.md", hash: hashUnchanged }, // Unchanged
      { path: "testFolder/test-file-moved.md", hash: hashMoved }, // Moved
      { path: "test-file-changed.md", hash: "different-hash" }, // Changed
      { path: "testFolder/test-file-moved-and-changed.md", hash: "different-hash" }, // Moved and Changed
                                                           // Deleted
      { path: "test-file-created.md", hash: "Some-hash" }, // Created
    ];

    // Define the expected update sessions
    const expectedUpdateSessions: PermittedChange[] = [
                                                  // Unchanged gets ignored
      { type: "delete", path: "test-file-moved.md"},  // Moved gets deleted first
      { type: "create", path: "testFolder/test-file-moved.md" }, // Moved gets created at new location
      { type: "update", path: "test-file-changed.md" }, // Changed gets updated
      { type: "delete", path: "test-file-moved-and-changed.md" }, // Moved and Changed gets deleted first
      { type: "create", path: "testFolder/test-file-moved-and-changed.md" }, // Moved and Changed gets created at new location
      { type: "delete", path: "test-file-deleted.md" }, // Deleted gets deleted
      { type: "create", path: "test-file-created.md" }, // Created gets created
    ];

    // Simulate a client request to /request-update
    console.log("Sending request-update request...");
    const response = await fastify.inject({
      method: "POST",
      url: "/request-update",
      payload: { manifest: clientManifest } satisfies requestUpdateRequestBody,
    });

    // Parse the response
    const { updateSessions } = JSON.parse(response.payload) as {
      updateSessions: updateSession[];
    };
    console.log("Received updateSessions:", util.inspect(updateSessions, {showHidden: false, depth: null, colors: true}));

    // Check the response
    expect(response.statusCode).toBe(200);
    expect(updateSessions).toBeDefined();

    // Check that correct amount of batches are created
    expect(updateSessions.length).toBe(3); 
    
    // Check amount of changes total
    const totalChanges = updateSessions.reduce((acc, session) => acc + session.permittedChanges.length, 0);
    expect(totalChanges).toBe(expectedUpdateSessions.length);

    // Check each expected change exists
    for (const expectedChange of expectedUpdateSessions) {
      const found = updateSessions.some((session) => session.permittedChanges.some((change) => change.path === expectedChange.path));
      if (!found) {
        console.error(`Expected change not found: ${util.inspect(expectedChange)}`);
      }
      expect(found).toBe(true);
    }

    // Simulate a client request to /update-batch for each session
    for (const session of updateSessions) {
      console.log(`Sending update-batch request for session: ${session.id}...`);

      // Prepare the changes
      const updates: Update[] = await Promise.all(session.permittedChanges.map(async (change) => {
        switch (change.type) {
          case "create":
            // Check if move to correctly model move
            let content = "Created content"
            if (change.path.includes("moved-and-changed")) {
              content = initialContentMovedAndChanged;
            } else if (change.path.includes("moved")) {
              content = initialContentMoved;
            }
            return {
              type: change.type,
              path: change.path,
              content: content,
            }
          case "update":
            return {
              type: change.type,
              path: change.path,
              content: "Updated content",
            }
          case "delete":
            return {
              type: change.type,
              path: change.path,
              content: "",
            }
        }
      }));
      console.log("Updates:", util.inspect(updates, {showHidden: false, depth: null, colors: true}));

      // Send
      const response = await fastify.inject({
        method: "POST",
        url: "/update-batch",
        payload: { id: session.id, updates: updates } satisfies updateBatchRequestBody,
      });

      // Parse the response
      const statuses = JSON.parse(response.payload) as { path: string; status: string }[];

      // Check the response
      expect(response.statusCode).toBe(200);
      expect(statuses).toBeDefined();

      // Check that all updates were successful
      for (const status of statuses) {
        expect(status.status).toBe("success");
      }
    }

    // Print the final server state
    console.log("/content:", await fs.readdir(CONTENT_DIR));
    console.log("/content/testFolder:", await fs.readdir(path.join(CONTENT_DIR, "testFolder")));

    // Check the final server state
    const finalContentUnchanged = await fs.readFile(filePathUnchanged, "utf-8");
    expect(finalContentUnchanged).toBe("Initial content unchanged");

    const finalContentMoved = await fs.readFile(path.join(CONTENT_DIR, "testFolder/test-file-moved.md"), "utf-8");
    expect(finalContentMoved).toBe("Initial content moved");
    // console.log(await fs.readFile(filePathMoved, "utf-8"));
    expect(() => fs.readFile(filePathMoved, "utf-8")).rejects.toThrow();

    const finalContentChanged = await fs.readFile(filePathChanged, "utf-8");
    expect(finalContentChanged).toBe("Updated content");

    const finalContentMovedAndChanged = await fs.readFile(path.join(CONTENT_DIR, "testFolder/test-file-moved-and-changed.md"), "utf-8");
    expect(finalContentMovedAndChanged).toBe("Initial content moved and changed");  
    expect(() => fs.readFile(filePathMovedAndChanged, "utf-8")).rejects.toThrow();

    expect(() => fs.readFile(filePathDeleted, "utf-8")).rejects.toThrow();

    const finalContentCreated = await fs.readFile(path.join(CONTENT_DIR, "test-file-created.md"), "utf-8");
    expect(finalContentCreated).toBe("Created content");
    
  }, 10000);
});
