#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5d16ade43e47ff436cb3b8bb57477e76a459f397df90515e06d64803c5f92bf4/contract';
import startContract from '../../snapshots/5d16ade43e47ff436cb3b8bb57477e76a459f397df90515e06d64803c5f92bf4/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/cce3197d83b71366e9566fc5fb1ec7dfea4e7cfc96a2fabde72de84e487719e3/contract';
import endContract from '../../snapshots/cce3197d83b71366e9566fc5fb1ec7dfea4e7cfc96a2fabde72de84e487719e3/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, placeholder } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
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
