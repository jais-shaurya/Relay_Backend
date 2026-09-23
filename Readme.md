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
- id serial primary key
- name varchar(100) not null
- email varchar(100) not null unique
- created_at time
- updated_at time

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

