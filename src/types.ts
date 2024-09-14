// General
export type Manifest = {
  path: string;
  hash: string;
}[];

export type updateSession = {
  id: string;
  permittedChanges: PermittedChange[];
  timeout?: ReturnType<typeof setTimeout>;
};

export type PermittedChange = {
  type: UpdateType;
  path: string;
};

export type Update = {
  type: UpdateType;
  path: string;
  content: string;
};

export type UpdateType = "create" | "update" | "delete";

// request-update Endpoint
export type requestUpdateRequestBody = {
  manifest: Manifest;
};

export type requestUpdateResponseBody = {
  updateSessions: updateSession[];
};

// update-batch Endpoint
export type updateBatchRequestBody = {
  id: string;
  updates: Update[];
};

export type updateBatchResponseBody = {
  path: string;
  status: "success" | "failure";
}[];
