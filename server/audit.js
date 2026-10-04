export async function audit(sql, { userId = null, action, entityType, entityId = null, metadata = {} }) {
  await sql`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (${userId}, ${action}, ${entityType}, ${entityId}, ${sql.json(metadata)})`;
}
