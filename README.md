# About

A simple backend to accept and apply file updates for obsidian markdown files hosted on a quartz server. <br>
Made to work in tandem with the [quartz_updater_obsidian_plugin](https://github.com/Dabemuc/quartz_updater_obsidian_plugin) <br>
Warning: This is made for a specific usecase and is missing alot of security etc.

# Environment vars
- CONTENT_DIR: string (Default "../content")
- UPDATE_SESSION_TIMEOUT: number (Default 60000)
- BATCH_SIZE: sumber (Default 10)

# Endpoints and their behavior

## `POST /request-update`

- **Description**: Takes a manifest representing the state of a fileszstem on the client, compares it to the servers manifest, creates update-sessions for each detected change and returns the update-sessions to the client.
- **Request body**: 
  ```json
  {
    "manifest": [
      {
        "path": "string",
        "hash": "string"
      },
      ...
    ]
  }
  ```
- **Response body**
  ```json
  {
    "updateSessions": [
      {
        "id": "string",
        "permittedChanges": [
          {
            "type": "string",
            "path": "string"
          },
          ...
        ],
      },
      ...
    ]
  }
  ```

## `POST /update-batch`

- **Description**: Takes an update session ID and a batch of updates, applies the updates to the server's filesystem, and returns the status of each update.
- **Request body**:
  ```json
  {
    "id": "string",
    "updates": [
      {
        "type": "string",
        "path": "string",
        "content": "string"
      },
      ...
    ]
  }
  ```
- **Response body**
  ```json
  [
    {
      "path": "string",
      "status": "success" | "failure"
    },
    ...
  ]
  ```