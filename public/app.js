const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const pretty = value => JSON.stringify(value, null, 2);
let fixtures, referenceId, heldId, proposalId, validationId, approved = false, loggedIn = false;
let validationText = '', monitorBusy = false, savedMappings = [];
const fingerprint = () => pretty([$ ('mapping').value, $('source').value, $('expected').value]);
function notice(message) { text('notice', message); $('notice').hidden = false; clearTimeout(notice.timer); notice.timer = setTimeout(() => $('notice').hidden = true, 9000); }
async function api(path, body) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-DPI-Workbench': '1' }, ...(body !== undefined ? { method: 'POST', body: pretty(body) } : {}) });
  const result = await response.json();
  if (response.status === 401) { loggedIn = false; $('login').hidden = false; $('workspace').hidden = true; }
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
function action(id, task) {
  $(id).addEventListener('click', async () => {
    const button = $(id); button.disabled = true;
    try { await task(); } catch (error) { notice(error.message); }
    finally { button.disabled = false; controls(); }
  });
}
function controls() {
  $('break').disabled = !referenceId;
  $('validate').disabled = !$('mapping').value.trim();
  $('approve').disabled = !validationId || validationText !== fingerprint() || approved;
  $('replay').disabled = !approved || !heldId || validationText !== fingerprint();
}
function mappingRows(mapping) {
  const container = $('mapping-table'); container.replaceChildren();
  for (const [target, field] of Object.entries(mapping.fields || {})) {
    const row = document.createElement('div'); row.className = 'mapping-row';
    const source = document.createElement('span'); source.textContent = field.path;
    const arrow = document.createElement('span'); arrow.textContent = '→';
    const destination = document.createElement('span'); destination.textContent = target;
    const transform = document.createElement('small'); transform.textContent = field.transform;
    destination.append(transform); row.append(source, arrow, destination); container.append(row);
  }
}
function invalidate() { validationId = null; approved = false; text('validation', 'Changed since validation. Validate this exact proposal before approval.'); $('validation').className = 'result'; controls(); }
$('mapping').addEventListener('input', () => { invalidate(); try { mappingRows(JSON.parse($('mapping').value)); } catch {} });
for (const id of ['source', 'expected']) $(id).addEventListener('input', invalidate);
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(section => section.hidden = section.id !== button.dataset.tab);
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === button));
  if (button.dataset.tab === 'monitor') refresh().catch(e => notice(e.message));
}));
async function start() {
  try {
    fixtures = await api('/fixtures'); loggedIn = true; $('login').hidden = true; $('workspace').hidden = false;
    $('source').value = pretty(fixtures.sampleV2); $('expected').value = pretty(fixtures.expected);
    const health = await api('/health'); text('health', health.metaConfigured ? '● Backend connected · Meta ready' : '● Backend connected · Meta not configured');
    await Promise.all([connections(), refresh(), loadMappings(), loadCompletionRepairs()]);
  } catch (e) { if (loggedIn) notice(e.message); }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); try { await api('/session/login', { token: $('token').value }); $('token').value = ''; await start(); } catch (e) { notice(e.message); }
});
action('logout', async () => { await api('/session/logout', {}); loggedIn = false; $('workspace').hidden = true; $('login').hidden = false; });
action('prepare', async () => {
  const saved = await api('/mappings', fixtures.mappingV1);
  const validated = await api(`/mappings/${saved.id}/validate`, { cases: [{ input: fixtures.sampleV1, expected: fixtures.expected }] });
  if (!validated.passed) throw new Error('Reference mapping failed validation');
  await api(`/mappings/${saved.id}/approve`, { validationId: validated.validationId, actor: 'workbench-reference-scenario' });
  referenceId = saved.id; text('scenario-status', 'Reference v1 mapping validated and approved. You can now send the changed v2 assessment.');
});
action('break', async () => {
  const response = await api('/simulator/assessments', { sourceEventId: `workbench-${crypto.randomUUID()}`, sourceVersion: '2', mappingId: referenceId, payload: JSON.parse($('source').value) });
  heldId = response.event.id;
  text('scenario-status', `Record ${heldId.slice(0, 8)}: ${response.event.status}. ${response.event.error || ''}`);
  notice('Changed assessment held for review. Its source data is preserved.'); await refresh();
});
action('propose', async () => {
  text('model-info', 'Muse is inspecting the synthetic source contract…');
  try {
    const result = await api('/meta/propose-mapping', { sourceSystem: 'community-simulator', sourceVersion: '2', syntheticDataConfirmed: true,
      sourceSchema: { clientId: 'stable patient identifier', measuredAt: 'ISO observation timestamp', vitals: { bp: 'systolic/diastolic numeric values separated by slash', unit: 'explicit unit, mmHg' } }, syntheticExample: JSON.parse($('source').value) });
    text('model-info', `${result.evidence.model} · ${(result.evidence.latencyMs / 1000).toFixed(1)}s · ${result.evidence.usage?.total_tokens ?? 'unknown'} tokens · real Meta API`);
    if (!result.mapping) throw new Error('Clarification needed: ' + result.questions.join('; '));
    $('mapping').value = pretty(result.mapping); mappingRows(result.mapping); invalidate();
    text('validation', 'Proposal received. Review the fields and validate before approval.');
  } catch (e) { text('model-info', 'Proposal unavailable. No replacement mapping was activated.'); throw e; }
});
action('validate', async () => {
  const specification = $('mapping').value;
  const snapshot = fingerprint();
  const input = JSON.parse($('source').value), expectedOutput = JSON.parse($('expected').value);
  const saved = await api('/mappings', JSON.parse(specification));
  const cases = [{ input, expected: expectedOutput },
    { input: { ...fixtures.sampleV2, clientId: 'DEMO-SECOND-002', vitals: { bp: '120/80', unit: 'mmHg' } }, expected: { ...fixtures.expected, patientId: 'DEMO-SECOND-002', systolic: 120, diastolic: 80 } }];
  const result = await api(`/mappings/${saved.id}/validate`, { cases });
  proposalId = saved.id; approved = false;
  validationId = result.passed ? result.validationId : null; validationText = snapshot;
  $('validation').className = `result ${result.passed ? 'pass' : 'fail'}`;
  text('validation', `${result.passed ? 'PASS · Both expected-output cases match.' : 'FAIL · Review the differences below.'}\n${result.result.map((r, i) => `Case ${i + 1}: ${r.passed ? pretty(r.actual) : pretty(r)}`).join('\n')}`);
  await loadMappings();
});
async function loadMappings() {
  savedMappings = await api('/mappings'); const select = $('saved-mapping'); select.replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a saved mapping…'; select.append(placeholder);
  for (const mapping of savedMappings) { const option = document.createElement('option'); option.value = mapping.id; option.textContent = `${mapping.spec.name} · v${mapping.spec.sourceVersion} · ${mapping.approved ? 'approved' : 'draft'}`; select.append(option); }
}
$('saved-mapping').addEventListener('change', () => {
  const mapping = savedMappings.find(m => m.id === $('saved-mapping').value); if (!mapping) return;
  $('mapping').value = pretty(mapping.spec); mappingRows(mapping.spec); invalidate();
  text('model-info', 'Loaded from saved mappings. No Meta request made. Revalidate against the current input before approval.');
});
action('approve', async () => {
  const actor = $('actor').value.trim(); if (!actor) throw new Error('Enter your reviewer name');
  await api(`/mappings/${proposalId}/approve`, { validationId, actor }); approved = true;
  notice('Your approval has been recorded for this exact mapping.');
});
action('replay', async () => {
  const event = await api(`/events/${heldId}/replay`, { mappingId: proposalId });
  text('scenario-status', `Record ${event.id.slice(0, 8)}: ${event.status}. ${event.error || 'See the exchange monitor for receiver verification.'}`);
  if (event.status === 'quarantined') throw new Error(event.error);
  heldId = null; await refresh(); notice('Record replayed. Delivery is confirmed only after receiver readback.');
});
async function connections() {
  const items = await api('/connections'); const list = $('connection-list'); list.replaceChildren();
  if (!items.length) { list.textContent = 'No registered systems yet. Add your first application.'; return; }
  for (const item of items) {
    const card = document.createElement('div'); card.className = 'connection';
    const title = document.createElement('h4'); title.textContent = item.name;
    const description = document.createElement('p'); description.textContent = `${item.target} · schema saved · not tested`;
    const test = document.createElement('button'); test.textContent = 'Test connection'; test.className = 'secondary';
    test.onclick = async () => { test.disabled = true; description.textContent = 'Checking endpoint…'; try { const result = await api(`/connections/${item.id}/test`, {}); description.textContent = `${result.ready ? 'Reachable' : 'Not ready'} · ${result.detail}`; } catch (e) { description.textContent = e.message; } finally { test.disabled = false; } };
    const details = document.createElement('details'), summary = document.createElement('summary'), schema = document.createElement('pre'); summary.textContent = 'View saved schema'; schema.textContent = pretty(item.schema); details.append(summary, schema);
    card.append(title, description, test, details); list.append(card);
  }
}
$('connection-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { await api('/connections', { name: $('connection-name').value.trim(), target: $('connection-target').value, schema: JSON.parse($('connection-schema').value) }); await connections(); notice('Application registered. Test its connection when ready.'); } catch (e) { notice(e.message); } finally { button.disabled = false; }
});
async function refresh() {
  if (!loggedIn || monitorBusy) return; monitorBusy = true;
  try {
    const [events, deliveries, audit, referrals, clients, feedback] = await Promise.all([api('/events'), api('/deliveries'), api('/audit'), api('/referrals'), api('/clients'), api('/feedback')]);
    renderClients(clients);
    renderReferrals(referrals, events, feedback);
    const byId = new Map(deliveries.map(d => [d.event_id, d])); $('stats').replaceChildren();
    for (const [label, count] of [['Recent records', events.length], ['Held for review', events.filter(e => e.status === 'quarantined').length], ['Awaiting delivery', events.filter(e => e.status === 'persisted').length], ['Verified delivery', events.filter(e => e.status === 'delivered').length]]) {
      const stat = document.createElement('div'); stat.className = 'stat'; const value = document.createElement('strong'); value.textContent = count; const caption = document.createElement('span'); caption.textContent = label; stat.append(value, caption); $('stats').append(stat);
    }
    $('events').replaceChildren();
    for (const event of events) {
      const delivery = byId.get(event.id), row = document.createElement('tr');
      for (const content of [event.source_event_id, event.source_version, event.status, String(delivery?.attempts ?? '—')]) { const cell = document.createElement('td'); cell.textContent = content; row.append(cell); }
      const cell = document.createElement('td'), button = document.createElement('button'); button.className = 'quiet'; button.textContent = 'Inspect';
      button.onclick = () => { $('event-detail').hidden = false; text('event-detail', pretty({ event, delivery: delivery || null })); }; cell.append(button);
      if (event.status === 'quarantined') {
        const repair = document.createElement('button'); repair.className = 'secondary'; repair.textContent = 'Repair';
        repair.onclick = () => { heldId = event.id; $('source').value = pretty(event.payload); invalidate(); text('scenario-status', `Repairing held record ${event.id.slice(0, 8)}. Review its expected values before validation.`); document.querySelector('[data-tab="repair"]').click(); };
        cell.append(repair);
      }
      row.append(cell); $('events').append(row);
    }
    $('audit').replaceChildren();
    for (const item of audit.slice(0, 15)) { const row = document.createElement('div'); row.className = 'audit-row'; const description = document.createElement('span'); description.textContent = `${item.action} · ${item.detail?.actor || item.subject.slice(0, 12)}`; const time = document.createElement('span'); time.textContent = new Date(item.created_at).toLocaleTimeString(); row.append(description, time); $('audit').append(row); }
    text('updated', `Updated ${new Date().toLocaleTimeString()} · latest 100 records`);
    const verified = events.filter(e => e.status === 'delivered').length;
    text('delivery-label', verified ? `${verified} records verified by receiver readback` : 'No verified delivery yet');
  } finally { monitorBusy = false; }
}
action('refresh', refresh);
function renderClients(clients) {
  const list = $('clients-list');
  const fingerprint = pretty(clients); if (list.dataset.snapshot === fingerprint) return; list.dataset.snapshot = fingerprint;
  list.replaceChildren();
  if (!clients.length) { list.textContent = 'Waiting for registry synchronization.'; return; }
  for (const client of clients) {
    const card = document.createElement('div'); card.className = 'connection';
    const title = document.createElement('h4'); title.textContent = client.registry_id ? `Health ID · ${client.registry_id}` : 'Identity registration pending';
    const state = document.createElement('p'); state.textContent = `${client.status}${client.error ? ' · ' + client.error : ''}`;
    const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'View shared timeline'; button.disabled = !client.registry_id;
    button.onclick = async () => {
      button.disabled = true;
      try {
        const result = await api(`/clients/${client.registry_id}/timeline`);
        const identity = $('patient-identity'); identity.replaceChildren();
        for (const identifier of result.patient.identifier || []) { const row = document.createElement('p'); row.textContent = `${identifier.system.replace('urn:dpi-h:patient:', '').replace('urn:dpi-h:', '')}: ${identifier.value}`; identity.append(row); }
        const timeline = $('patient-timeline'); timeline.replaceChildren();
        const resources = result.resources.sort((a,b) => (a.effectiveDateTime || a.authoredOn || a.lastModified || '').localeCompare(b.effectiveDateTime || b.authoredOn || b.lastModified || ''));
        for (const resource of resources) {
          const item = document.createElement('div'); item.className = 'connection'; const heading = document.createElement('h4');
          heading.textContent = resource.resourceType === 'Observation' ? (resource.valueString ? 'Hospital care outcome' : 'Community assessment · blood pressure') : resource.resourceType === 'ServiceRequest' ? 'PHU → hospital referral' : resource.description ? 'Community follow-up' : 'Referral handover status';
          const body = document.createElement('p'); body.textContent = resource.resourceType === 'Observation' ? resource.valueString || `${resource.component.map(c => c.valueQuantity.value).join('/')} mmHg · ${resource.effectiveDateTime}` : resource.resourceType === 'ServiceRequest' ? `${resource.reasonCode?.[0]?.text} · ${resource.status}` : [resource.businessStatus?.text, resource.description, resource.restriction?.period?.end].filter(Boolean).join(' · ');
          const source = document.createElement('p'); source.className = 'hint'; source.textContent = `Source: ${resource.meta?.source || 'not recorded'}`;
          item.append(heading, body, source); timeline.append(item);
        }
        if (result.truncated) { const note = document.createElement('p'); note.textContent = 'Showing the first 100 records per resource type.'; timeline.append(note); }
      } catch (e) { notice(e.message); } finally { button.disabled = false; }
    };
    card.append(title, state, button); list.append(card);
  }
}
let referralRequestId = crypto.randomUUID();
$('referral-form').addEventListener('submit', async event => {
  event.preventDefault(); event.submitter.disabled = true;
  try {
    await api('/referrals', { requestId: referralRequestId, eventId: $('referral-event').value, reason: $('referral-reason').value, urgency: $('referral-urgency').value, actor: $('referral-actor').value });
    referralRequestId = crypto.randomUUID(); await refresh(); notice('Referral queued for Makeni. Delivery will be verified by hospital readback.');
  } catch (e) { notice(e.message); } finally { event.submitter.disabled = false; }
});
function renderReferrals(referrals, events, feedback) {
  const select = $('referral-event'), selected = select.value;
  const options = events.filter(e => e.status === 'delivered');
  if (select.dataset.ids !== options.map(e => e.id).join(',')) {
    select.replaceChildren(); select.dataset.ids = options.map(e => e.id).join(',');
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a verified PHU assessment'; select.append(placeholder);
    for (const event of options) { const option = document.createElement('option'); option.value = event.id; option.textContent = `${event.canonical?.patientId || 'Synthetic patient'} · ${event.source_event_id}`; select.append(option); }
    select.value = selected;
  }
  const list = $('referral-list'); list.replaceChildren();
  if (!referrals.length) { list.textContent = 'No hospital referrals yet.'; return; }
  for (const referral of referrals) {
    const card = document.createElement('div'); card.className = 'connection';
    const title = document.createElement('h4'); title.textContent = `${referral.id.slice(0, 8)} · ${referral.status}`;
    const summary = document.createElement('p'); summary.textContent = `${referral.urgency} · Binkolo → Makeni · ${referral.attempts} delivery attempts`;
    const reason = document.createElement('p'); reason.textContent = referral.reason;
    card.append(title, summary, reason);
    for (const outcome of feedback.outcomes.filter(f => f.referral_id === referral.id)) {
      const task = feedback.followups.find(t => t.feedback_id === outcome.id);
      for (const message of [
        'Hospital-verified outcome: ' + outcome.payload.summary,
        'PHU return: ' + outcome.status + (outcome.error ? ' · ' + outcome.error : ''),
        'Community follow-up: ' + (task?.instruction || 'pending'),
        'Due: ' + (task?.due_date?.slice(0,10) || 'pending'),
        'ComEMR: ' + (feedback.communityDeliveries?.find(d => d.task_id === task?.id)?.state || 'awaiting verified patient linkage')
      ]) { const info = document.createElement('p'); info.textContent = message; card.append(info); }
    }
    for (const task of feedback.followups.filter(t => t.referral_id === referral.id && t.purpose === 'integration-rehearsal')) {
      const p = document.createElement('p');
      p.textContent = `Integration rehearsal · ${task.status} · Due ${task.due_date.slice(0,10)} · ${feedback.communityOutcomes?.some(o=>o.task_id===task.id) ? 'Completion read back from ComEMR API' : 'Awaiting ComEMR outcome'}`;
      card.append(p);
    }
    for (const problem of feedback.errors.filter(e => e.referral_id === referral.id)) { const warning = document.createElement('p'); warning.textContent = 'Feedback needs review: ' + problem.error; card.append(warning); }
    if (referral.error) { const error = document.createElement('p'); error.textContent = `Awaiting retry: ${referral.error}`; card.append(error); }
    if (['delivered', 'accepted'].includes(referral.status)) {
      const next = referral.status === 'delivered' ? 'accepted' : 'completed';
      const button = document.createElement('button'); button.className = 'secondary'; button.textContent = next === 'accepted' ? 'Record hospital acceptance' : 'Record completion';
      button.onclick = async () => { button.disabled = true; try { await api(`/referrals/${referral.id}/status`, { status: next, actor: $('handover-actor').value, note: $('handover-note').value }); await refresh(); } catch (e) { notice(e.message); button.disabled = false; } };
      card.append(button);
    }
    const details = document.createElement('details'), label = document.createElement('summary'), receipt = document.createElement('pre'); label.textContent = 'Delivery evidence'; receipt.textContent = pretty(referral.receipt || { status: 'Waiting for hospital readback' }); details.append(label, receipt); card.append(details); list.append(card);
  }
}
setInterval(() => { if (loggedIn && !document.hidden) refresh().catch(e => text('updated', `Refresh failed: ${e.message}`)); }, 5000);
let cr = null, crRows = [], crBusy = false;
function crMapping() { return JSON.parse($('cr-mapping').value); }
function crMatches() { try { return cr && pretty(crMapping()) === pretty(cr.mapping); } catch { return false; } }
function crControls() {
  const final = cr?.state === 'replayed';
  for (const id of ['cr-create','cr-saved','cr-task','cr-actor']) $(id).disabled = crBusy;
  $('cr-mapping').disabled = crBusy || !cr || final;
  $('cr-propose').disabled = crBusy || !cr || final;
  $('cr-use-proposal').disabled = crBusy || !cr?.proposal?.mapping || final;
  $('cr-validate').disabled = crBusy || !cr || final || !$('cr-mapping').value.trim();
  $('cr-approve').disabled = crBusy || cr?.state !== 'validated' || !crMatches() || !$('cr-actor').value.trim();
  $('cr-replay').disabled = crBusy || !['approved','replayed'].includes(cr?.state) || !crMatches();
}
async function loadCompletionRepairs() {
 const [tasks,rows] = await Promise.all([api('/completion-repairs/tasks'),api('/completion-repairs')]); crRows = rows;
 const selected=$('cr-task').value; $('cr-task').replaceChildren();
 for(const t of tasks){const o=document.createElement('option');o.value=t.task_id;o.textContent=`ComEMR ${t.receiver_id} · ${t.purpose}`;$('cr-task').append(o);}if(selected)$('cr-task').value=selected;
 $('cr-saved').replaceChildren();const first=document.createElement('option');first.value='';first.textContent='Choose a saved repair…';$('cr-saved').append(first);
 for(const r of rows){const o=document.createElement('option');o.value=r.id;o.textContent=`${r.id.slice(0,8)} · ${r.state}`;$('cr-saved').append(o);}if(cr)$('cr-saved').value=cr.id;
 crControls();
}
function showCompletionRepair(row) {
 cr=row; text('cr-input',pretty(row.input));text('cr-expected',pretty(row.expected));
 $('cr-mapping').value=row.mapping ? pretty(row.mapping) : '';
 text('cr-state',`${row.state.toUpperCase()} · ${row.id.slice(0,8)}${row.approved_by ? ' · Approved by '+row.approved_by : ''}`);
 text('cr-validation',row.validation ? `${row.validation.passed?'PASS':'FAIL'}
${row.validation.results.map(r=>r.name+': '+(r.passed?'passed':r.error||'values differ')).join('\n')}` : 'No validation yet.');
 $('cr-receipt').hidden=!row.receipt;text('cr-receipt',row.receipt?pretty(row.receipt):'');
 text('cr-model',row.proposal ? `${row.proposal.evidence.model} · ${row.proposal.evidence.usage?.total_tokens ?? '?'} tokens · Saved Meta proposal` : 'One paid request per click. Only an independently synthetic example is sent to Meta.');
 crControls();
}
function crAction(id,fn){$(id).onclick=async()=>{crBusy=true;crControls();try{await fn();await loadCompletionRepairs();}catch(e){notice(e.message);}finally{crBusy=false;crControls();}};}
$('cr-mapping').oninput=()=>{text('cr-validation','Mapping edited. Validate again before approval or replay.');crControls();};$('cr-actor').oninput=crControls;
$('cr-saved').onchange=()=>{const row=crRows.find(r=>r.id===$('cr-saved').value);if(row)showCompletionRepair(row);};
crAction('cr-create',async()=>{showCompletionRepair(await api('/completion-repairs',{taskId:$('cr-task').value}));});
crAction('cr-propose',async()=>{text('cr-model','Muse is preparing a mapping…');const result=await api(`/completion-repairs/${cr.id}/propose`,{});cr.proposal=result;text('cr-model',`${result.evidence.model} · ${result.evidence.usage?.total_tokens ?? '?'} tokens · Real Meta response`);if(!result.mapping)throw new Error(result.questions.join('; '));$('cr-mapping').value=pretty(result.mapping);text('cr-validation','Review this proposal, then validate.');});
crAction('cr-use-proposal',async()=>{$('cr-mapping').value=pretty(cr.proposal.mapping);text('cr-validation','Saved proposal restored. Validate before approval.');});
crAction('cr-validate',async()=>showCompletionRepair(await api(`/completion-repairs/${cr.id}/validate`,{mapping:crMapping()})));
crAction('cr-approve',async()=>showCompletionRepair(await api(`/completion-repairs/${cr.id}/approve`,{mapping:crMapping(),validationId:cr.validation_id,actor:$('cr-actor').value.trim()})));
crAction('cr-replay',async()=>{showCompletionRepair(await api(`/completion-repairs/${cr.id}/replay`,{mapping:crMapping(),validationId:cr.validation_id}));await refresh();});
start();
