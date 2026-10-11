#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/36bcd39b73514e039e7b6741a52d4059983fc889fd323bb2074910b726568200/contract';
import endContract from '../../snapshots/36bcd39b73514e039e7b6741a52d4059983fc889fd323bb2074910b726568200/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/5d16ade43e47ff436cb3b8bb57477e76a459f397df90515e06d64803c5f92bf4/contract';
import startContract from '../../snapshots/5d16ade43e47ff436cb3b8bb57477e76a459f397df90515e06d64803c5f92bf4/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, placeholder } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'deployment',
        column: col('createdAt', 'timestamptz', {
          notNull: true,
          default: fn('now()'),
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'deployment',
        column: col('replicas', 'int4', {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'deployment',
        column: col('status', 'text', {
          notNull: true,
          default: lit('PENDING'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'deployment',
        column: col('commitHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dataTransform(endContract, 'backfill-deployment-commitHash', {
        check: () => placeholder('backfill-deployment-commitHash:check'),
        run: () => placeholder('backfill-deployment-commitHash:run'),
      }),
      this.setNotNull({ schema: 'public', table: 'deployment', column: 'commitHash' }),
      this.addColumn({
        schema: 'public',
        table: 'deployment',
        column: col('image', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dataTransform(endContract, 'backfill-deployment-image', {
        check: () => placeholder('backfill-deployment-image:check'),
        run: () => placeholder('backfill-deployment-image:run'),
      }),
      this.setNotNull({ schema: 'public', table: 'deployment', column: 'image' }),
      this.addColumn({
        schema: 'public',
        table: 'deployment',
        column: col('projectId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.dataTransform(endContract, 'backfill-deployment-projectId', {
        check: () => placeholder('backfill-deployment-projectId:check'),
        run: () => placeholder('backfill-deployment-projectId:run'),
      }),
      this.setNotNull({ schema: 'public', table: 'deployment', column: 'projectId' }),
      this.addColumn({
        schema: 'public',
        table: 'deployment',
        column: col('updatedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.dataTransform(endContract, 'backfill-deployment-updatedAt', {
        check: () => placeholder('backfill-deployment-updatedAt:check'),
        run: () => placeholder('backfill-deployment-updatedAt:run'),
      }),
      this.setNotNull({ schema: 'public', table: 'deployment', column: 'updatedAt' }),
      this.addColumn({
        schema: 'public',
        table: 'deployment',
        column: col('url', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dataTransform(endContract, 'backfill-deployment-url', {
        check: () => placeholder('backfill-deployment-url:check'),
        run: () => placeholder('backfill-deployment-url:run'),
      }),
      this.setNotNull({ schema: 'public', table: 'deployment', column: 'url' }),
      this.addColumn({
        schema: 'public',
        table: 'project',
        column: col('port', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.dataTransform(endContract, 'backfill-project-port', {
        check: () => placeholder('backfill-project-port:check'),
        run: () => placeholder('backfill-project-port:run'),
      }),
      this.setNotNull({ schema: 'public', table: 'project', column: 'port' }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'deployment',
        constraint: 'deployment_status_check_d16b4cfd',
        expression: "\"status\" IN ('PENDING', 'DEPLOYED', 'FAILED')",
      }),
      this.addUnique({
        schema: 'public',
        table: 'project',
        constraint: 'project_name_key',
        columns: ['name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'deployment',
        index: 'deployment_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'deployment',
        foreignKey: {
          name: 'deployment_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
