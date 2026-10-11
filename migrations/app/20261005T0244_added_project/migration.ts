#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5d16ade43e47ff436cb3b8bb57477e76a459f397df90515e06d64803c5f92bf4/contract';
import endContract from '../../snapshots/5d16ade43e47ff436cb3b8bb57477e76a459f397df90515e06d64803c5f92bf4/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fe5b9d7df0c2743a25060bdc81250bca7455822e9774e6a0febb7b91c53fb9d4/contract';
import startContract from '../../snapshots/fe5b9d7df0c2743a25060bdc81250bca7455822e9774e6a0febb7b91c53fb9d4/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'deployment',
        columns: [col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } })],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'project',
        columns: [
          col('branch', 'text', {
            notNull: true,
            default: lit('main'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('buildCommand', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('installCommand', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'runtime',
        columns: [
          col('baseImage', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'runtime',
        constraint: 'runtime_name_key',
        columns: ['name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'project',
        index: 'project_runtimeId_idx_dd339145',
        columns: ['runtimeId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'project',
        index: 'project_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'project',
        foreignKey: {
          name: 'project_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'project',
        foreignKey: {
          name: 'project_runtimeId_fkey',
          columns: ['runtimeId'],
          references: { schema: 'public', table: 'runtime', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
