import { readFileSync } from 'node:fs';
import { ComEmr, CommunityDelivery, CommunityLink } from '../src/community.js';
import { Store } from '../src/store.js';
const taskId = process.argv[2];
if (!taskId || !process.env.COMEMR_USERNAME || !process.env.COMEMR_PASSWORD || !process.env.COMEMR_LINK_FILE) throw new Error('Provide a task ID, COMEMR_USERNAME, COMEMR_PASSWORD and COMEMR_LINK_FILE in local .env. No delivery attempted.');
const link = CommunityLink.parse(JSON.parse(readFileSync(process.env.COMEMR_LINK_FILE,'utf8')));
const adapter = new ComEmr(process.env.COMEMR_BASE_URL ?? 'http://127.0.0.1:3000',process.env.COMEMR_CLIENT ?? 'web');
await adapter.login(process.env.COMEMR_USERNAME,process.env.COMEMR_PASSWORD,process.env.COMEMR_PASSWORD_HASH_KEY ?? 'spice_uat');
const store = new Store(process.env.DATABASE_URL!);
try { const delivery = new CommunityDelivery(store); await delivery.init(); const result = await delivery.deliver(taskId,link,adapter); console.log(JSON.stringify({taskId,state:result.state,receipt:result.receipt,error:result.error},null,2)); }
finally { await store.pool.end(); }
