SELECT id
FROM accounts
WHERE id = ANY($1::uuid[])
ORDER BY id
FOR UPDATE;
