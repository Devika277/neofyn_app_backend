const pool = require('../config/db');

async function generateMemberId(client) {
  // Get the next sequence value
  const seqResult = await client.query(
    "SELECT nextval('users_id_seq') as next_id"
  );
  const nextId = seqResult.rows[0].next_id;
  
  // Generate member ID: NEO + year + padded number
  const year = new Date().getFullYear();
  const paddedId = String(nextId).padStart(4, '0');
  const memberId = `NEO${year}${paddedId}`;
  
  // Ensure it's not longer than 20 characters
  if (memberId.length > 20) {
    return memberId.substring(0, 20);
  }
  
  return memberId;
}

module.exports = { generateMemberId };