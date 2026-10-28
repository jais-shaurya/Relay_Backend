# Relay Backend API

Base API prefix: `/api/v1`. All request and response bodies use JSON unless noted otherwise. The schemas below use TypeScript notation to show exact field names, types, and nullability.

## Shared schemas and middleware

### Headers

- Every route requires `x-api-key: string` with the configured API key.
- Every `/api/v1` route requires `Authorization: Bearer <Firebase ID token>`. `/api/v1/auth` applies Firebase verification in its own router; other API routes apply it in the API router.
- The token must verify and contain Firebase UID, email, and name. Controllers use the verified UID to resolve the Relay user. Clients must not provide a user ID to act as another user.
- Health routes are outside `/api/v1`: `/health` requires only the API key; `/secured/user` requires the API key and Firebase token.

### Shared response schemas

```ts
type ValidationIssue = {
  code: string;
  path: Array<string | number>;
  message: string;
  [key: string]: unknown;
};

type ValidationError = {
  message: string;
  errors: ValidationIssue[];
};

type MessageError = {
  message: string;
};

type UnauthorizedError = {
  error: 'unauthorized';
  message: string;
};

type InvalidApiKeyError = {
  error: 'Forbidden';
  message: 'Invalid API Key';
};
```

- Missing/invalid API key: `403 InvalidApiKeyError`.
- Missing, expired, malformed, or rejected Firebase token: `401 UnauthorizedError`.
- Verified Firebase token without email or name: `401 UnauthorizedError`.
- Malformed JSON request body: `400 { message: string }`.
- Unmatched route: `404 { message: string }` with message `Route not found`. Unmatched `/api/v1` requests still pass through API authentication first.
- Unexpected controller or infrastructure failure: route-specific `500 MessageError`; raw internal exceptions are not returned.

### Database response object schemas

```ts
type User = {
  id: number;
  firebaseUid: string;
  email: string;
  name: string;
  createdAt: string; // serialized timestamp
  updatedAt: string; // serialized timestamp
};

type Runtime = {
  id: number;
  name: string;
  baseImage: string;
};

type Project = {
  id: number;
  userId: number;
  runtimeId: number;
  name: string;
  repoUrl: string;
  branch: string;
  runtimeVersion: string;
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  port: number;
  createdAt: string; // serialized timestamp
  updatedAt: string; // serialized timestamp
};

type DeploymentStatus =
  | 'PENDING'
  | 'BUILDING'
  | 'DEPLOYING'
  | 'DEPLOYED'
  | 'FAILED'
  | 'DELETED';

type Deployment = {
  id: number;
  projectId: number;
  image: string;
  url: string;
  status: DeploymentStatus;
  replicas: number;
  commitHash: string | null;
  jenkinsQueueUrl: string | null;
  jenkinsBuildNumber: number | null;
  createdAt: string; // serialized timestamp
  updatedAt: string; // serialized timestamp
};

type JenkinsBuildStatus =
  | 'BUILDING'
  | 'SUCCESS'
  | 'FAILURE'
  | 'ABORTED'
  | 'UNSTABLE';

type ProgressiveLog = {
  text: string;
  nextOffset: number;
  hasMore: boolean;
};
```

All ID path parameters use positive safe integers written as decimal strings. Log offsets use nonnegative safe integers written as decimal query strings.

## Health

### `GET /health`

- Input: `x-api-key` header; no body or query parameters.
- `200`: `{ status: 'OK'; message: 'API is healthy' }`.
- `403`: `InvalidApiKeyError`.

### `GET /secured/user`

- Input: `x-api-key` header and Firebase bearer token; no body or query parameters.
- `200`: `{ status: 'OK'; message: 'Secured API is healthy' }`.
- `401`: `UnauthorizedError`.
- `403`: `InvalidApiKeyError`.

## Authentication and user profile

### `POST /api/v1/auth`

- Input: verified Firebase bearer token; no request body is used. UID, email, and name are read from the verified token.
- `200`: `{ user: User }`.
- `400`: `ValidationError` with message `Invalid verified Firebase account.` or `MessageError` with message `A verified Firebase account email and name are required.`
- `401`: `MessageError` with message `Authentication required.`
- `409`: `MessageError` with message `This email is already associated with another Firebase account.`
- `500`: `MessageError` with message `Unable to initialize user profile.`

### `GET /api/v1/users`

- Input: verified Firebase bearer token; no body or query parameters.
- `200`: `{ user: User }`.
- `401`: `MessageError` with message `Authentication required.` or `Invalid verified Firebase account.`
- `404`: `MessageError` with message `User profile not found.`
- `500`: `MessageError` with message `Unable to retrieve user profile.`

### `PATCH /api/v1/users`

- Input body:

```ts
type UpdateUserProfileInput = {
  name: string; // trimmed, length 1–100
};
```

- Additional body fields are rejected.
- `200`: `{ user: User }` containing the updated profile.
- `400`: `ValidationError` with message `Invalid profile update.`
- `401`: `MessageError` with message `Authentication required.` or `Invalid verified Firebase account.`
- `404`: `MessageError` with message `User profile not found.`
- `500`: `MessageError` with message `Unable to update user profile.`

### `DELETE /api/v1/users`

- Input: verified Firebase bearer token; no body or query parameters.
- `200`: `{ message: 'User profile deleted.' }`.
- `401`: `MessageError` with message `Authentication required.` or `Invalid verified Firebase account.`
- `404`: `MessageError` with message `User profile not found.`
- `409`: `MessageError` with message `User profile cannot be deleted while projects still reference it.`
- `500`: `MessageError` with message `Unable to delete user profile.`
- The Firebase Authentication account is not deleted. Existing project foreign keys can prevent profile deletion.

### `POST /api/v1/users/logout`

- Input: verified Firebase bearer token; no body or query parameters.
- `200`: `{ message: 'Refresh tokens revoked.' }`.
- `401`: `MessageError` with message `Authentication required.` or `Invalid verified Firebase account.`
- `500`: `MessageError` with message `Unable to log out.`

## Runtimes

### `GET /api/v1/runtimes`

- Input: verified Firebase bearer token; no body or query parameters.
- `200`: `{ runtimes: Runtime[] }`. Each runtime has exactly `id`, `name`, and `baseImage`; records are ordered by name.
- `401`: `UnauthorizedError`.
- `500`: `MessageError` with message `Unable to list runtimes.`

### `GET /api/v1/runtimes/:runtimeId`

- Input: `runtimeId` positive safe integer path parameter.
- `200`: `{ runtime: Runtime }`.
- `400`: `ValidationError` with message `Invalid runtime ID.`
- `401`: `UnauthorizedError`.
- `404`: `MessageError` with message `Runtime not found.`
- `500`: `MessageError` with message `Unable to retrieve runtime.`

## Projects

Project CRUD manages saved configuration only; it does not trigger Jenkins or Kubernetes. `name` is globally unique. A project update is blocked after any deployment history exists.

### `POST /api/v1/projects`

- Input body:

```ts
type CreateProjectInput = {
  name: string; // trimmed, length 1–100
  runtimeId: number; // positive safe integer referencing an existing runtime
  repoUrl: string; // URL using http:, https:, ssh:, or git:
  branch?: string; // trimmed, length 1–255; defaults to 'main'
  runtimeVersion: string; // /^[A-Za-z0-9._-]{1,64}$/
  installCommand: string; // maximum length 2000; empty string is allowed
  buildCommand: string; // maximum length 2000; empty string is allowed
  startCommand: string; // maximum length 2000; empty string is allowed
  port: number; // integer 1–65535
};
```

- Extra fields, including `userId`, are rejected. Ownership comes from the Firebase UID.
- `201`: `{ project: Project }`.
- `400`: `ValidationError` with message `Invalid project configuration.` or `MessageError` with message `runtimeId does not reference an available runtime.`
- `401`: `MessageError` with message `Authentication required.`
- `404`: `MessageError` with message `User profile not found. Initialize a profile before managing projects.`
- `409`: `MessageError` with message `A project with that name already exists.`
- `500`: `MessageError` with message `Unable to create project.`

### `GET /api/v1/projects`

- Input: verified Firebase bearer token; no body or query parameters.
- `200`: `{ projects: Project[] }`, owned projects ordered newest first.
- `401`: `MessageError` with message `Authentication required.`
- `404`: `MessageError` with message `User profile not found. Initialize a profile before managing projects.`
- `500`: `MessageError` with message `Unable to list projects.`

### `GET /api/v1/projects/:projectId`

- Input: `projectId` positive safe integer path parameter.
- `200`: `{ project: Project }`, only when owned by the authenticated user.
- `400`: `ValidationError` with message `Invalid project ID.`
- `401`: `MessageError` with message `Authentication required.`
- `404`: profile missing with the message above, or `MessageError` with message `Project not found.` for a missing or unowned project.
- `500`: `MessageError` with message `Unable to retrieve project.`

### `PATCH /api/v1/projects/:projectId`

- Input: positive safe integer `projectId` path parameter and a nonempty partial body containing one or more `CreateProjectInput` fields. `branch` has no default for updates. Extra fields are rejected.
- `200`: `{ project: Project }` with all 13 project fields after update.
- `400`: `ValidationError` with message `Invalid project ID.` or `Invalid project update.`; also `MessageError` with message `runtimeId does not reference an available runtime.`
- `401`: `MessageError` with message `Authentication required.`
- `404`: profile missing with the message above, or `MessageError` with message `Project not found.`
- `409`: `MessageError` with message `A project with that name already exists.` or `Project configuration cannot be updated after a deployment has been created.`
- `500`: `MessageError` with message `Unable to update project.`

### `DELETE /api/v1/projects/:projectId`

- Input: positive safe integer `projectId` path parameter; no body.
- `200`: `{ message: 'Project deleted.' }`.
- `400`: `ValidationError` with message `Invalid project ID.`
- `401`: `MessageError` with message `Authentication required.`
- `404`: profile missing with the message above, or `MessageError` with message `Project not found.`
- `409`: `MessageError` with message `Project cannot be deleted while deployment history exists.` or `Project cannot be deleted while deployments reference it.` if a foreign-key race occurs.
- `500`: `MessageError` with message `Unable to delete project.`

## Deployments

Deployment records are retained as history. Deployment status values and complete response fields are:

```ts
type DeploymentStatus =
  | 'PENDING'
  | 'BUILDING'
  | 'DEPLOYING'
  | 'DEPLOYED'
  | 'FAILED'
  | 'DELETED';

type Deployment = {
  id: number;
  projectId: number;
  image: string;
  url: string;
  status: DeploymentStatus;
  replicas: number;
  commitHash: string | null;
  jenkinsQueueUrl: string | null;
  jenkinsBuildNumber: number | null;
  createdAt: string; // serialized timestamp
  updatedAt: string; // serialized timestamp
};
```

### `POST /api/v1/projects/:projectId/deployments`

- Input: positive safe integer `projectId` path parameter; body is optional:

```ts
type CreateDeploymentInput = {
  replicas?: number; // integer 1–20; defaults to 1
};
```

- Extra fields are rejected. The project must be owned by the caller and use a supported runtime (`node` or `python`). Relay generates a Dockerfile from saved configuration, triggers Jenkins, then deploys through Kubernetes after a successful build.
- `201`: `{ deployment: Deployment }` only after Kubernetes reports the requested replicas ready.
- `202`: `{ deployment: Deployment; buildStatus?: JenkinsBuildStatus }` while build or deployment work is incomplete.
- `400`: `ValidationError` with message `Invalid project ID.` or `Invalid deployment request.`; or `MessageError` with message `The project's runtime no longer exists.` or `The project runtime uses an unsupported Docker base image.`
- `401`: `MessageError` with message `Authentication required.`
- `404`: profile missing with the user profile message above, or `MessageError` with message `Project not found.` for missing/unowned project.
- `409`: `{ message: 'A deployment is already in progress for this project.'; deploymentId: number }`.
- `500`: `MessageError` with message `Unable to prepare deployment build.` if Dockerfile generation fails, or `Unable to start deployment.` for other setup/database failures.
- `502`: `MessageError` with message `Jenkins rejected the deployment build.`; or `{ message: 'The Jenkins build or Kubernetes deployment failed.'; deployment: Deployment }` when build/deployment fails.
- `503`: uncertain Jenkins acceptance returns `{ message: string; deploymentId: number; status: 'PENDING' }`; accepted build with queue persistence failure returns `{ message: string; deploymentId: number }`; progress service failure returns `{ message: string; deployment: Deployment | null }`. Keep the persisted deployment; do not retry blindly if Jenkins may have accepted the build.

Legacy aliases (`POST /api/v1/deployments/project/:projectId` and `GET /api/v1/deployments/project/:projectId`) have been removed; use the canonical project-scoped endpoints.

### `GET /api/v1/projects/:projectId/deployments`

- Input: positive safe integer `projectId` path parameter.
- `200`: `{ deployments: Deployment[] }`, newest first for an owned project.
- `400`: `ValidationError` with message `Invalid project ID.`
- `401`: `MessageError` with message `Authentication required.`
- `404`: profile missing with the user profile message above, or `MessageError` with message `Project not found.` for missing/unowned project.
- `500`: `MessageError` with message `Unable to list deployments.`

### `GET /api/v1/deployments/:deploymentId`

- Input: positive safe integer `deploymentId` path parameter.
- This read polls Jenkins/Kubernetes for nonterminal deployments and may persist a lifecycle status change.
- `200`: `{ deployment: Deployment; buildStatus?: JenkinsBuildStatus }` when lifecycle processing is complete or status is terminal.
- `202`: `{ deployment: Deployment; buildStatus?: JenkinsBuildStatus }` while pending, building, or deploying.
- `400`: `ValidationError` with message `Invalid deployment ID.`
- `401`: `MessageError` with message `Authentication required.`
- `404`: profile missing with the user profile message above, or `MessageError` with message `Deployment not found.` for missing/unowned deployment.
- `500`: `MessageError` with message `Unable to retrieve deployment.`

### `GET /api/v1/deployments/:deploymentId/logs?start=<offset>`

- Input: positive safe integer `deploymentId` path parameter; optional `start` nonnegative safe integer query parameter, default `0`.
- `200`: `{ text: string; nextOffset: number; hasMore: boolean }`.
- `400`: `ValidationError` with message `Invalid deployment ID.` or `Invalid log offset.`
- `401`: `MessageError` with message `Authentication required.`
- `404`: profile missing with the user profile message above, or `MessageError` with message `Deployment not found.` for missing/unowned deployment.
- `409`: `MessageError` with message `Jenkins build has not started yet.`
- `500`: `MessageError` with message `Unable to retrieve deployment logs.`

### `PATCH /api/v1/deployments/:deploymentId`

- Input: positive safe integer `deploymentId`; request body may be omitted or be a JSON object. The current service exposes no supported update operation.
- `501`: `MessageError` with message `Deployment updates are not supported by the current Kubernetes service.`. No deployment is changed.
- `400`: `ValidationError` with message `Invalid deployment ID.` or `Invalid deployment update.`
- This endpoint currently returns `501` after authentication and input checks; it does not perform an ownership lookup because it performs no operation and returns no deployment data.

### `DELETE /api/v1/deployments/:deploymentId`

- Input: positive safe integer `deploymentId`; no body.
- `200`: `{ message: string; deploymentId: number; status: 'DELETED' }`. This marks the retained history row; it does not delete it. Repeated deletion returns message `Deployment is already deleted.`
- `400`: `ValidationError` with message `Invalid deployment ID.`
- `401`: `MessageError` with message `Authentication required.`
- `404`: profile missing with the user profile message above, or `MessageError` with message `Deployment not found.` for missing/unowned deployment.
- `409` messages by state:
  - `Deployment setup is still in progress. Retry deletion after its status advances.` (`PENDING`)
  - `Deployment is still being provisioned. Retry deletion after provisioning completes.` (`DEPLOYING`)
  - `The Jenkins build may still be queued and cannot be cancelled.` (building without a build number)
  - `The Jenkins build is active and cannot be cancelled.` or `The Jenkins build is still active and cannot be cancelled.` (Jenkins reports building)
  - `The Jenkins build may still be queued; deletion cannot be confirmed yet.` (failed status but unresolved queue)
  - `Deployment lifecycle advanced concurrently. Retry deletion after checking its status.` (concurrent transition)
- `500`: `MessageError` with message `Unable to delete deployment resources.` if Kubernetes cleanup or status persistence fails.

## Jenkins builds

```ts
type JenkinsBuildStatus =
  | 'BUILDING'
  | 'SUCCESS'
  | 'FAILURE'
  | 'ABORTED'
  | 'UNSTABLE';

type ProgressiveLog = {
  text: string;
  nextOffset: number;
  hasMore: boolean;
};
```

A build is accessible only when its build number is stored on a deployment belonging to the authenticated user. Supplying a build number alone never grants access.

### `GET /api/v1/builds/:buildNumber`

- Input: positive safe integer `buildNumber` path parameter.
- `200`: `{ buildNumber: number; status: JenkinsBuildStatus; deploymentId: number }` for a terminal Jenkins result (`SUCCESS`, `FAILURE`, `ABORTED`, or `UNSTABLE`).
- `202`: `{ buildNumber: number; status: JenkinsBuildStatus; deploymentId: number }` while Jenkins reports `BUILDING`.
- `400`: `ValidationError` with message `Invalid build number.`
- `401`: `MessageError` with message `A verified Firebase UID is required.` when no Firebase user is attached; `400` with the same message if a Firebase user object exists but has no UID.
- `404`: `MessageError` with message `User profile not found.` or `Build not found.` when no associated owned deployment exists.
- `500`: `MessageError` with message `Unable to retrieve build.`
- Polling updates a deployment to `BUILDING` or `FAILED` only while its saved status is `PENDING` or `BUILDING`.

### `GET /api/v1/builds/:buildNumber/logs?start=<offset>`

- Input: positive safe integer `buildNumber`; optional nonnegative safe integer `start` offset, default `0`.
- `200`: `{ buildNumber: number; text: string; nextOffset: number; hasMore: boolean }`.
- `400`: `ValidationError` with message `Invalid build number.` or `Invalid log offset.`
- `401`: `MessageError` with message `A verified Firebase UID is required.` when no Firebase user is attached; `400` with the same message if a Firebase user object exists but has no UID.
- `404`: `MessageError` with message `User profile not found.` or `Build not found.` when no associated owned deployment exists.
- `500`: `MessageError` with message `Unable to retrieve build logs.`

## Lifecycle notes

- A deployment progresses through `PENDING`, `BUILDING`, `DEPLOYING`, and `DEPLOYED`; failures use `FAILED`. Deletion retains the row and sets `DELETED` only after cleanup or confirmation that no Kubernetes resources were created.
- A `202` response means poll `GET /api/v1/deployments/:deploymentId` for persisted status. The current architecture does not guarantee background progress survives a backend restart.
- Project deletion and user deletion are restricted by existing foreign keys and deployment history.
- Jenkins, PostgreSQL, and Kubernetes are separate systems; service availability and application URL reachability depend on configured infrastructure.
