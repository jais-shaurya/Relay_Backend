# Relay Backend 

## Tech Stack 
Node.js
Express.js 
Postgres
Prisma
Jenkins 
Kubernetes


## Backend Routes



## Postgres Schemas
### user
- `id` — serial, primary key
- `name` — string, not null
- `email` — string, not null, unique
- `created_at` — timestamp with time zone, not null
- `updated_at` — timestamp with time zone, not null

### runtime
- `id` — serial, primary key
- `name` — string, not null, unique
- `base_image` — string, not null

### project
- `id` — serial, primary key
- `user_id` — integer, foreign key → `user.id`, not null
- `runtime_id` — integer, foreign key → `runtime.id`, not null
- `name` — string, not null, unique
- `repo_url` — string, not null
- `branch` — string, not null, default `"main"`
- `runtime_version` — string, not null
- `install_command` — string, not null
- `build_command` — string, not null
- `start_command` — string, not null
- `port` — integer, not null
- `created_at` — timestamp with time zone, not null
- `updated_at` — timestamp with time zone, not null

### deployment
- `id` — serial, primary key
- `project_id` — integer, foreign key → `project.id`, not null
- `image` — string, not null
- `url` — string, not null
- `status` — enum (`PENDING`, `DEPLOYED`, `FAILED`), not null, default `PENDING`
- `replicas` — integer, not null, default `1`
- `commit_hash` — string, not null
- `created_at` — timestamp with time zone, not null
- `updated_at` — timestamp with time zone, not null

#### Relationships
\- `deployment.project_id` → `project.id`
- `ON DELETE RESTRICT`


## Response Schemas
### Error
{
    error: "",
    message: ""
}


## Commands
### To migrate to new schema (do only when you change src/prisma/contract.prisma)
npx prisma contract emit (or) npm run contract:emit
npx prisma migration plan --name [your-migration-name]

### To apply local migrations to remote db
npx prisma db migrate --advance-ref db

