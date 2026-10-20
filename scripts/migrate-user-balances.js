const mongoose = require('mongoose');
const { parseAmount } = require('../utils/amounts');

const fields = [
  'availbalance',
  'activedeposit',
  'activeinvestment',
  'cashback',
  'todaysspending'
];
const applyChanges = process.argv.includes('--apply');

async function migrate() {
  const { mongoURI } = require('../config/keys');
  if (!mongoURI) {
    throw new Error('MongoDB URI is not configured in config/keys.js.');
  }

  await mongoose.connect(mongoURI, { useNewUrlParser: true });

  const collection = mongoose.connection.collection('users');
  const projection = { _id: 1 };
  fields.forEach(field => { projection[field] = 1; });
  const cursor = collection.find({}, { projection });
  const invalidCounts = Object.fromEntries(fields.map(field => [field, 0]));
  let scanned = 0;
  let convertedFields = 0;
  let pendingUpdates = [];

  try {
    let account = await cursor.next();
    while (account) {
      scanned += 1;
      const updates = {};
      for (const field of fields) {
        const value = account[field];
        if (value === undefined || value === null) {
          continue;
        }
        if (typeof value === 'number' && Number.isFinite(value)) continue;

        const converted = parseAmount(value);
        if (converted === null) {
          invalidCounts[field] += 1;
          continue;
        }
        updates[field] = converted;
      }

      if (Object.keys(updates).length > 0) {
        convertedFields += Object.keys(updates).length;
        if (applyChanges) {
          pendingUpdates.push(collection.updateOne(
            { _id: account._id },
            { $set: updates }
          ));
          if (pendingUpdates.length >= 100) {
            await Promise.all(pendingUpdates);
            pendingUpdates = [];
          }
        }
      }

      account = await cursor.next();
    }

    await Promise.all(pendingUpdates);
  } finally {
    await cursor.close();
    await mongoose.disconnect();
  }

  console.log(`${applyChanges ? 'Converted' : 'Would convert'} ${convertedFields} balance fields across ${scanned} accounts.`);
  const invalidFields = Object.entries(invalidCounts).filter(([, count]) => count > 0);
  if (invalidFields.length > 0) {
    console.error('Could not parse these fields; their original database values were left unchanged:');
    invalidFields.forEach(([field, count]) => console.error(`  ${field}: ${count} account(s)`));
    process.exitCode = 1;
  }

  if (!applyChanges) {
    console.log('Dry run only. Re-run with -- --apply to save these conversions.');
  }
}

migrate().catch(async error => {
  console.error('Balance migration failed:', error.message);
  await mongoose.disconnect();
  process.exitCode = 1;
});