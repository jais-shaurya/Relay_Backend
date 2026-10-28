#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5da398dd9677713ea2404d8405bdd9933844c7f3d29f4edb85ae21b96ca4a365/contract';
import endContract from '../../snapshots/5da398dd9677713ea2404d8405bdd9933844c7f3d29f4edb85ae21b96ca4a365/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'Deployment',
        columns: [
          col('commitHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('image', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('jenkinsBuildNumber', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('jenkinsQueueUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('replicas', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('url', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'Deployment_status_check_76f50c81',
            sql`"status" IN ('PENDING', 'BUILDING', 'DEPLOYING', 'DEPLOYED', 'FAILED', 'DELETED')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'Project',
        columns: [
          col('branch', 'text', {
            notNull: true,
            default: lit('main'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('buildCommand', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('installCommand', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('port', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('repoUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runtimeId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('runtimeVersion', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startCommand', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'Runtime',
        columns: [
          col('baseImage', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'User',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Project',
        constraint: 'Project_name_key',
        columns: ['name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Runtime',
        constraint: 'Runtime_name_key',
        columns: ['name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'User',
        constraint: 'User_email_key',
        columns: ['email'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Deployment',
        index: 'Deployment_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Project',
        index: 'Project_runtimeId_idx_dd339145',
        columns: ['runtimeId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Project',
        index: 'Project_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Deployment',
        foreignKey: {
          name: 'Deployment_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'Project', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Project',
        foreignKey: {
          name: 'Project_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Project',
        foreignKey: {
          name: 'Project_runtimeId_fkey',
          columns: ['runtimeId'],
          references: { schema: 'public', table: 'Runtime', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
