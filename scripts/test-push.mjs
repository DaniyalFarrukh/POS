import Database from 'file:///D:/POS/node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js';
import jwt from 'file:///D:/POS/node_modules/.pnpm/jsonwebtoken@9.0.3/node_modules/jsonwebtoken/index.js';

const db = new Database('C:/Users/daniy/AppData/Roaming/HexaPharm/pharmacy.db');

const rows = db.prepare("SELECT * FROM outbox WHERE synced_at IS NULL").all();

const secret = 'hexapharm_pos_production_secure_jwt_secret_2026_pk';
const token = jwt.sign({
  typ: 'device',
  deviceId: '01a1d624-5263-7560-b517-3d889d0082b1',
  pharmacyId: '01a1cfdf-d1c1-7ccc-b495-6e40d917df99',
  branchId: '01a1cfdf-d3ae-7cee-9f30-7f84005023ae',
  counterId: '01a1cfdf-d4a1-70a5-9f6e-2f6cfee01d14'
}, secret, { expiresIn: '90d', audience: 'pos:device' });

const envelopes = rows.map((r) => ({
  eventId: r.event_id || r.id,
  deviceSeq: r.device_seq,
  type: r.type || r.event_type,
  entityId: r.entity_id || r.event_id || r.id,
  occurredAt: r.occurred_at || r.created_at,
  schemaVersion: 1,
  payload: JSON.parse(r.payload),
}));

console.log('Sending envelopes:', envelopes.length);

const resp = await fetch('https://api.hexalogictechandsolutions.com/sync/push', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token
  },
  body: JSON.stringify({ events: envelopes })
});

console.log('HTTP Status:', resp.status);
const json = await resp.json();
console.log('Push Results:', JSON.stringify(json, null, 2));
