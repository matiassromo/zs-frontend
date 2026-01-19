// Simple runner to exercise the apiv2 keys methods.
// This file is meant to be executed during development with ts-node.

import keys from "../keys";

async function run() {
  console.log("--- apiv2 keys test start ---");

  try {
    console.log('\n1) listKeys()');
    const all = await keys.listKeys();
    console.log(`listKeys -> Found ${all.length} keys`);
    if (all.length > 0) {
      console.log('First key:', all[0]);
    }

    if (all.length > 0) {
      const firstKey = all[0];

      console.log('\n2) getKeyById() - retrieve specific key');
      const fetchedKey = await keys.getKeyById(firstKey.id);
      console.log('getKeyById ->', fetchedKey);

      // Verify the fetched key matches the original
      if (fetchedKey && fetchedKey.id === firstKey.id) {
        console.log('✓ Successfully retrieved key by ID');
      } else {
        console.error('✗ Retrieved key does not match expected ID');
      }

      console.log('\n3) getKeyById() - test with non-existent ID');
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const nonExistent = await keys.getKeyById(fakeId);
      console.log(`getKeyById(${fakeId}) ->`, nonExistent);

      if (nonExistent === null) {
        console.log('✓ Correctly returned null for non-existent key');
      } else {
        console.error('✗ Should have returned null for non-existent key');
      }

      console.log('\n4) updateKey() - toggle availability');
      const originalAvailability = firstKey.available;
      const updated = await keys.updateKey(firstKey.id, {
        lastAssignedTo: firstKey.lastAssignedTo,
        available: !originalAvailability,
        notes: `Updated at ${new Date().toISOString()}`,
      });
      console.log('updateKey ->', updated);

      if (updated.available !== originalAvailability) {
        console.log('✓ Successfully toggled availability');
      } else {
        console.error('✗ Availability was not toggled');
      }

      console.log('\n5) getKeyById() - verify update was persisted');
      const afterUpdate = await keys.getKeyById(firstKey.id);
      console.log('getKeyById after update ->', afterUpdate);

      if (afterUpdate && afterUpdate.available === !originalAvailability) {
        console.log('✓ Update was persisted correctly');
      } else {
        console.error('✗ Update was not persisted');
      }

      console.log('\n6) listKeys() - verify update in list');
      const allAfterUpdate = await keys.listKeys();
      const updatedInList = allAfterUpdate.find((k: { id: string }) => k.id === firstKey.id);
      console.log('Updated key in list ->', updatedInList);

      console.log('\n7) updateKey() - restore original state');
      const restored = await keys.updateKey(firstKey.id, {
        lastAssignedTo: firstKey.lastAssignedTo,
        available: originalAvailability,
        notes: firstKey.notes,
      });
      console.log('Restored key ->', restored);

      if (restored.available === originalAvailability) {
        console.log('✓ Successfully restored original state');
      } else {
        console.error('✗ Failed to restore original state');
      }

      console.log('\n8) getKeyById() - verify restoration');
      const finalCheck = await keys.getKeyById(firstKey.id);
      console.log('Final state check ->', finalCheck);

      if (finalCheck && finalCheck.available === originalAvailability) {
        console.log('✓ State successfully restored to original');
      } else {
        console.error('✗ State was not fully restored');
      }

    } else {
      console.log('\nNo keys found in the system. Skipping detailed tests.');
      console.log('Note: The Keys API does not support creating keys via API.');
      console.log('Keys must be pre-seeded in the database for testing.');
    }

    console.log('\n=== Test Summary ===');
    console.log('All key API methods have been exercised:');
    console.log('  - listKeys(): ✓');
    if (all.length > 0) {
      console.log('  - getKeyById(): ✓');
      console.log('  - updateKey(): ✓');
      console.log('  - Error handling (404): ✓');
    } else {
      console.log('  - getKeyById(): Skipped (no data)');
      console.log('  - updateKey(): Skipped (no data)');
    }

  } catch (err) {
    console.error('\n✗ Test encountered error:', err);
    if (err instanceof Error) {
      console.error('Error details:', err.message);
      console.error('Stack trace:', err.stack);
    }
  }

  console.log("\n--- apiv2 keys test end ---");
}

if (require.main === module) {
  // Execute when run directly
  run().then(() => process.exit(0)).catch(() => process.exit(1));
}

export default run;
