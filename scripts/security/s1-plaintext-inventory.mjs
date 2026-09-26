import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const assertClean = process.argv.includes("--assert-clean");

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const client = new Client({
  connectionString: databaseUrl,
  application_name: "shawtie-s1-plaintext-inventory",
});

const checks = [
  {
    category: "messages",
    sql: `
      SELECT partnership_id, count(*)::int AS count
      FROM messages
      WHERE deleted_at IS NULL
        AND (
          body_text IS NOT NULL
          OR (ciphertext IS NOT NULL AND body_content_key_id IS NULL)
        )
      GROUP BY partnership_id
      ORDER BY partnership_id
    `,
  },
  {
    category: "message_reactions",
    sql: `
      SELECT partnership_id, count(*)::int AS count
      FROM message_reactions
      WHERE removed_at IS NULL
        AND (
          emoji_text IS NOT NULL
          OR (encrypted_reaction IS NOT NULL AND content_key_id IS NULL)
        )
      GROUP BY partnership_id
      ORDER BY partnership_id
    `,
  },
  {
    category: "partnership_chat_nicknames",
    sql: `
      SELECT partnership_id, count(*)::int AS count
      FROM partnership_chat_nicknames
      WHERE nickname IS NOT NULL
         OR (encrypted_nickname IS NOT NULL AND content_key_id IS NULL)
      GROUP BY partnership_id
      ORDER BY partnership_id
    `,
  },
  {
    category: "relationship_items",
    sql: `
      SELECT partnership_id, count(*)::int AS count
      FROM relationship_items
      WHERE lifecycle = 'active'
        AND (
          development_preview_payload IS NOT NULL
          OR development_plaintext_payload IS NOT NULL
          OR (
            encrypted_preview_payload IS NOT NULL
            AND preview_content_key_id IS NULL
          )
          OR (
            encrypted_payload IS NOT NULL
            AND main_content_key_id IS NULL
          )
        )
      GROUP BY partnership_id
      ORDER BY partnership_id
    `,
  },
  {
    category: "media_objects",
    sql: `
      SELECT partnership_id, count(*)::int AS count
      FROM media_objects
      WHERE deleted_at IS NULL
        AND state IN ('uploading', 'ready_unbound', 'bound')
        AND (
          crypto_protocol_version <> 'shawtie.mls.v1'
          OR content_key_id IS NULL
        )
      GROUP BY partnership_id
      ORDER BY partnership_id
    `,
  },
];

await client.connect();

try {
  const categories = [];
  const partnershipIds = new Set();
  let total = 0;

  for (const check of checks) {
    const result = await client.query(check.sql);
    const partnerships = result.rows.map((row) => {
      const count = Number(row.count);
      total += count;
      partnershipIds.add(row.partnership_id);
      return {
        partnershipId: row.partnership_id,
        count,
      };
    });
    categories.push({
      category: check.category,
      count: partnerships.reduce((sum, item) => sum + item.count, 0),
      partnerships,
    });
  }

  const report = {
    version: 1,
    cryptoProfile: "shawtie.mls.v1",
    generatedAt: new Date().toISOString(),
    totalBlockers: total,
    partnershipCount: partnershipIds.size,
    categories,
  };

  console.log(JSON.stringify(report, null, 2));

  if (total === 0) {
    console.log("S1_PLAINTEXT_INVENTORY_CLEAN");
  } else {
    console.log(
      "S1_PLAINTEXT_INVENTORY_BLOCKED count="
        + total
        + " partnerships="
        + partnershipIds.size,
    );
    if (assertClean) {
      process.exitCode = 1;
    }
  }
} finally {
  await client.end();
}
