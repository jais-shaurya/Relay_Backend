#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2909913299f968647787816fc1792978487cc2ef9083014fa050f401e77a1864/contract';
import endContract from '../../snapshots/2909913299f968647787816fc1792978487cc2ef9083014fa050f401e77a1864/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/5da398dd9677713ea2404d8405bdd9933844c7f3d29f4edb85ae21b96ca4a365/contract';
import startContract from '../../snapshots/5da398dd9677713ea2404d8405bdd9933844c7f3d29f4edb85ae21b96ca4a365/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addRequiredColumnToEmptyTable({
        schema: 'public',
        table: 'User',
        column: 'firebaseUid',
        type: 'text',
      }),
      this.addUnique({
        schema: 'public',
        table: 'User',
        constraint: 'User_firebaseUid_key',
        columns: ['firebaseUid'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
