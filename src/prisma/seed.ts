import { db } from './db.js';

async function seed() {
  console.log('Seeding initial runtimes...');

  const runtimesToSeed = [
    { name: 'Node.js', baseImage: 'node' },
    { name: 'Python', baseImage: 'python' },
  ];

  for (const item of runtimesToSeed) {
    const existing = await db.orm.public.Runtime.where({ name: item.name }).first();
    if (!existing) {
      const created = await db.orm.public.Runtime.create(item);
      console.log(`Created runtime: ${created.name} (id: ${created.id})`);
    } else {
      console.log(`Runtime already exists: ${existing.name} (id: ${existing.id})`);
    }
  }

  const all = await db.orm.public.Runtime.all();
  console.log('All available runtimes in database:', all);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
