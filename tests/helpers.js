'use strict';
/*
 * Shared helpers for the PCC Dashboard checks.
 *
 * Everything here uses MADE-UP data only: invented agent names, phone numbers
 * in the reserved 555-01xx range, and invented call notes. No real people,
 * no patient data, no production exports.
 *
 * The app is one static file (index.html) with no server. The checks open it in
 * a real Chromium browser through Playwright, load made-up CSV / Excel files
 * through the real upload boxes, and read what the screens show.
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const APP_URL = 'file://' + path.join(ROOT, 'index.html');
const XLSX_LIB = path.join(ROOT, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');

/* ---------- CSV writing ---------- */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** rows: array of plain objects. headers: optional explicit column order. */
function toCSV(rows, headers) {
  const head = headers || Object.keys(rows[0] || {});
  return [head.map(csvCell).join(',')]
    .concat(rows.map(r => head.map(h => csvCell(r[h])).join(',')))
    .join('\r\n') + '\r\n';
}
/** A file object Playwright can put into an <input type=file>. */
function csvFile(name, rows, headers) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(toCSV(rows, headers), 'utf8') };
}
function rawFile(name, text, mimeType = 'text/csv') {
  return { name, mimeType, buffer: Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8') };
}

/* ---------- column lists for each export the app recognises ---------- */
const HEAD = {
  queueDetails: ['Start time [US/Central]', 'Queue', 'Agent Name', 'Outcome', 'Left Queue Reason', 'Met SL',
    'Wait time (s)', 'Talk duration (s)', 'Agent ring time (s)', 'Call duration (s)', 'Conversation Space Ids'],
  conversations: ['Date [America/Chicago]', 'End time [America/Chicago]', 'Direction', 'Call Result', 'From',
    'Participants', 'Duration [Milliseconds]', 'Sentiment', 'Topics', 'AI Summary', 'Voicemails', 'Recordings'],
  productivity: ['Agent name', '# of queues', 'Logged in', 'Available', 'Working', 'Paused', 'Utilization', 'Occupancy'],
  individual: ['Agent name', 'Handled calls', 'Avg. handle time (hh:mm:ss)', 'Avg. wrap up time (hh:mm:ss)',
    'Avg. hold time (hh:mm:ss)', 'Hold count', 'Transfers', 'Missed ring attempts', 'Missed ring percentage',
    'Avg. ring time (millis)', 'Total talk time (hh:mm:ss)', 'Workload (hh:mm:ss)'],
  activity: ['User Name', 'Start Time', 'Superstate', 'Substate', 'Duration'],
  pause: ['Agent name', 'Pause reason', 'Pause Duration (hh:mm:ss)', 'Pause Count'],
  byDate: ['Start time [US/Central]', 'End time', 'Total calls count', 'Handled count', 'Abandoned count',
    'Outflowed system count', 'Average speed of answer (s)', 'Longest wait for answer (s)', 'Met SL %'],
  byQueue: ['Queue', 'Total calls count', 'Handled count'],
  agentCalls: ['Contact ID', 'Handle Time (millis)', 'Agent name'],
};

/* ---------- small row builders (all optional fields have safe defaults) ---------- */
let _seq = 0;
function qRow(o = {}) {
  _seq++;
  return {
    'Start time [US/Central]': o.start || '2026-03-02T10:00:00-06:00',
    'Queue': o.queue == null ? 'Main Line' : o.queue,
    'Agent Name': o.agent == null ? '' : o.agent,
    'Outcome': o.outcome || 'handled',
    'Left Queue Reason': o.reason == null ? (o.outcome && o.outcome !== 'handled' ? '' : 'agent answered') : o.reason,
    'Met SL': o.sl == null ? '' : o.sl,
    'Wait time (s)': o.wait == null ? '' : o.wait,
    'Talk duration (s)': o.talk == null ? '' : o.talk,
    'Agent ring time (s)': o.ring == null ? '' : o.ring,
    'Call duration (s)': o.call == null ? '' : o.call,
    'Conversation Space Ids': o.cid == null ? 'cid-' + _seq : o.cid,
  };
}
function cRow(o = {}) {
  return {
    'Date [America/Chicago]': o.date || '2026-03-02T10:00:00-06:00',
    'End time [America/Chicago]': o.end || '',
    'Direction': o.dir || 'Inbound',
    'Call Result': o.res || 'Ended successfully',
    'From': o.from == null ? '+13125550100' : o.from,
    'Participants': o.parts || '',
    'Duration [Milliseconds]': o.dur == null ? 60000 : o.dur,
    'Sentiment': o.sent || 'Neutral',
    'Topics': o.topics || '',
    'AI Summary': o.sum || '',
    'Voicemails': o.vm || 'false',
    'Recordings': o.rec || 'false',
  };
}

/* ---------- THE STANDARD MADE-UP DATA SET ----------
 * Small on purpose, so every expected number below can be worked out by hand.
 * Dates: Mon 2 Mar 2026 to Wed 4 Mar 2026, plus one Saturday (7 Mar 2026).
 * Shift is the app default: 9 AM to 6 PM Central.
 *
 * Queue calls (one row per call unless stated):
 *   Mon 2 Mar: 6 handled (Asha Rao x3, Ben Cole x3), 2 no-agent in shift, 1 abandoned
 *   Tue 3 Mar: 5 handled (Asha x2, Ben x2, Cara Diaz x1), 1 queue timeout, 1 abandoned
 *   Wed 4 Mar: 4 handled (Asha x2, Cara x2), 1 no-agent in shift, 1 no-agent before shift (7 AM),
 *              1 caller exited the menu (outflowed customer, no reason)
 *   One Tuesday call has TWO legs with the same call id (first leg outflowed, second handled):
 *   it must count once, as handled.
 * Totals: 24 rows = 23 unique calls offered, handled 15, no agent 4 (3 in shift, 1 before shift),
 *         abandoned 2, queue timeout 1, caller exited the menu 1. See EXPECT_QUEUE below.
 */
function standardQueueRows() {
  const rows = [];
  const H = (day, hh, agent, sl, wait, talk, queue) => rows.push(qRow({
    start: `2026-03-0${day}T${String(hh).padStart(2, '0')}:15:00-06:00`, agent, outcome: 'handled',
    reason: 'agent answered', sl, wait, talk, ring: 4, call: wait + talk, queue }));
  // Monday
  H(2, 9, 'Asha Rao', 'YES', 5, 120); H(2, 10, 'Asha Rao', 'YES', 8, 180); H(2, 11, 'Asha Rao', 'NO', 40, 240);
  H(2, 13, 'Ben Cole', 'YES', 6, 100); H(2, 15, 'Ben Cole', 'YES', 4, 200); H(2, 17, 'Ben Cole', 'YES', 7, 160, 'Billing');
  rows.push(qRow({ start: '2026-03-02T12:05:00-06:00', outcome: 'outflowed system', reason: 'no agents - joined empty' }));
  rows.push(qRow({ start: '2026-03-02T12:40:00-06:00', outcome: 'outflowed system', reason: 'no agents - joined empty' }));
  rows.push(qRow({ start: '2026-03-02T14:20:00-06:00', outcome: 'abandoned', reason: 'caller hung up', sl: 'NO', wait: 55 }));
  // Tuesday
  H(3, 9, 'Asha Rao', 'YES', 5, 150); H(3, 11, 'Asha Rao', 'YES', 9, 90);
  H(3, 12, 'Ben Cole', 'YES', 3, 210); H(3, 14, 'Ben Cole', 'NO', 35, 300);
  // one call, two legs: first leg bounced out, second leg handled by Cara
  rows.push(qRow({ start: '2026-03-03T16:00:00-06:00', outcome: 'outflowed system', reason: 'queue overflow', cid: 'two-leg-call' }));
  rows.push(qRow({ start: '2026-03-03T16:01:00-06:00', agent: 'Cara Diaz', outcome: 'handled', reason: 'agent answered',
    sl: 'YES', wait: 10, talk: 140, ring: 5, call: 150, cid: 'two-leg-call', queue: 'Billing' }));
  rows.push(qRow({ start: '2026-03-03T13:30:00-06:00', outcome: 'outflowed system', reason: 'queue timeout', sl: 'NO', wait: 300 }));
  rows.push(qRow({ start: '2026-03-03T15:45:00-06:00', outcome: 'abandoned', reason: 'caller hung up', sl: 'NO', wait: 25 }));
  // Wednesday
  H(4, 10, 'Asha Rao', 'YES', 6, 130); H(4, 11, 'Asha Rao', 'YES', 7, 170);
  H(4, 13, 'Cara Diaz', 'YES', 5, 110); H(4, 16, 'Cara Diaz', 'YES', 8, 190);
  rows.push(qRow({ start: '2026-03-04T12:10:00-06:00', outcome: 'outflowed system', reason: 'no agents - joined empty' }));
  rows.push(qRow({ start: '2026-03-04T07:10:00-06:00', outcome: 'outflowed system', reason: 'no agents - joined empty' }));
  rows.push(qRow({ start: '2026-03-04T15:10:00-06:00', outcome: 'outflowed customer', reason: '' }));
  return rows;
}
/* Expected answers for standardQueueRows(), worked out by hand. */
const EXPECT_QUEUE = {
  legs: 24,            // rows in the file
  offered: 23,         // unique calls (the two-leg call counts once)
  handled: 15,
  noAgentAll: 4,
  noAgentInShift: 3,
  noAgentOffShift: 1,
  abandoned: 2,
  queueTimeout: 1,
  callerExited: 1,     // 23 - 15 - 4 - 1 - 2
  notAnswered: 8,      // 23 - 15
  slYesInShift: 13,
  slNoInShift: 5,      // 2 handled late + 2 abandoned + 1 timeout
  byDay: { '2026-03-02': { total: 9, handled: 6 }, '2026-03-03': { total: 7, handled: 5 }, '2026-03-04': { total: 7, handled: 4 } },
  handledByAgent: { 'Asha Rao': 7, 'Ben Cole': 5, 'Cara Diaz': 3 },
};

/* Call log. Inbound calls in shift on weekdays: 12 (8 answered, 3 missed, 1 voicemail).
 * Plus: 1 inbound missed before shift (8 AM), 1 inbound missed on Saturday,
 *       2 outbound (one is a callback to a missed caller, 30 minutes later), 1 internal. */
function standardCallLog() {
  const rows = [];
  const D = (day, hh, mm = 0) => `2026-03-0${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-06:00`;
  let n = 100;
  const inb = (day, hh, res, extra = {}) => rows.push(cRow(Object.assign(
    { date: D(day, hh, 5), dir: 'Inbound', res, from: '+1312555' + String(++n).padStart(4, '0') }, extra)));
  // Monday: 4 answered, 1 missed at 12
  inb(2, 9, 'Ended successfully', { sent: 'Positive', topics: 'scheduling, insurance', sum: 'Caller booked a routine visit for next week.' });
  inb(2, 10, 'Ended successfully', { sent: 'Neutral', topics: 'order status' });
  inb(2, 11, 'Ended successfully', { sent: 'Negative', topics: 'billing', sum: 'Caller was unhappy about a long wait on hold before being helped.' });
  inb(2, 15, 'Ended successfully', { sent: 'Positive' });
  rows.push(cRow({ date: D(2, 12, 5), dir: 'Inbound', res: 'Missed Call', from: '+13125550150', dur: 20000 }));
  // Monday: outbound callback to that missed caller 30 minutes later
  rows.push(cRow({ date: D(2, 12, 35), end: D(2, 12, 37), dir: 'Outbound', res: 'Ended successfully', from: 'Asha Rao', parts: 'Asha Rao, +1 312-555-0150' }));
  // Tuesday: 2 answered, 1 missed at 13, 1 voicemail at 14
  inb(3, 9, 'Ended successfully', { sent: 'Neutral' });
  inb(3, 16, 'Ended successfully', { sent: 'Positive' });
  rows.push(cRow({ date: D(3, 13, 5), dir: 'Inbound', res: 'Missed Call', from: '+13125550151', dur: 15000 }));
  rows.push(cRow({ date: D(3, 14, 5), dir: 'Inbound', res: 'Sent to voicemail', from: '+13125550152', vm: 'true' }));
  // Wednesday: 2 answered, 1 missed at 12, 1 missed BEFORE shift at 8
  inb(4, 10, 'Ended successfully', { sent: 'Neutral' });
  inb(4, 16, 'Ended successfully', { sent: 'Neutral' });
  rows.push(cRow({ date: D(4, 12, 5), dir: 'Inbound', res: 'Missed Call', from: '+13125550153', dur: 30000 }));
  rows.push(cRow({ date: D(4, 8, 5), dir: 'Inbound', res: 'Missed Call', from: '+13125550154', dur: 10000 }));
  // Saturday 7 Mar at 11 AM: 1 missed (office closed on weekends)
  rows.push(cRow({ date: '2026-03-07T11:05:00-06:00', dir: 'Inbound', res: 'Missed Call', from: '+13125550155', dur: 12000 }));
  // other outbound + internal
  rows.push(cRow({ date: D(3, 10, 30), dir: 'Outbound', res: 'Ended successfully', from: 'Ben Cole', parts: 'Ben Cole, +13125550199' }));
  rows.push(cRow({ date: D(4, 11, 30), dir: 'Internal', res: 'Ended successfully', from: 'Asha Rao', parts: 'Asha Rao, Cara Diaz' }));
  return rows;
}
const EXPECT_CALLS = {
  total: 17,
  inbound: 14, outbound: 2, internal: 1,
  missedInbound: 5,                 // all missed calls, any time
  missedInShiftWeekday: 3,          // Mon 12, Tue 13, Wed 12
  missedBeforeShift: 1,
  missedWeekend: 1,
  voicemail: 1,
  calledBack: 1,                    // +13125550150
  inboundInShiftWeekday: 12,
};

function standardProductivity() {
  return [
    { 'Agent name': 'Asha Rao', '# of queues': 2, 'Logged in': '24:00:00', 'Available': '6:00:00', 'Working': '16:00:00', 'Paused': '2:00:00', 'Utilization': '91.7', 'Occupancy': '66.7' },
    { 'Agent name': 'Ben Cole', '# of queues': 2, 'Logged in': '30:00:00', 'Available': '5:00:00', 'Working': '15:00:00', 'Paused': '10:00:00', 'Utilization': '66.7', 'Occupancy': '50.0' },
    { 'Agent name': 'Cara Diaz', '# of queues': 1, 'Logged in': '16:00:00', 'Available': '4:00:00', 'Working': '11:00:00', 'Paused': '1:00:00', 'Utilization': '93.8', 'Occupancy': '68.8' },
    { 'Agent name': 'Billing Admin', '# of queues': 1, 'Logged in': '72:00:00', 'Available': '72:00:00', 'Working': '0:00:00', 'Paused': '0:00:00', 'Utilization': '100', 'Occupancy': '0' },
  ];
}
function standardIndividual() {
  const r = (a, h, aht, miss, mp) => ({ 'Agent name': a, 'Handled calls': h, 'Avg. handle time (hh:mm:ss)': aht,
    'Avg. wrap up time (hh:mm:ss)': '00:00:30', 'Avg. hold time (hh:mm:ss)': '00:01:00', 'Hold count': 2, 'Transfers': 1,
    'Missed ring attempts': miss, 'Missed ring percentage': mp, 'Avg. ring time (millis)': 4000,
    'Total talk time (hh:mm:ss)': '01:00:00', 'Workload (hh:mm:ss)': '02:00:00' });
  return [r('Asha Rao', 7, '00:04:00', 1, '12.5'), r('Ben Cole', 5, '00:06:30', 3, '37.5'), r('Cara Diaz', 3, '00:03:30', 0, '0')];
}
function standardActivity() {
  const rows = [];
  const add = (a, day, st, sub, dur) => rows.push({ 'User Name': a, 'Start Time': `2026-03-0${day}T09:00:00-06:00`, 'Superstate': st, 'Substate': sub, 'Duration': dur });
  [2, 3, 4].forEach(d => { add('Asha Rao', d, 'Working', 'Talking', '05:00:00'); add('Asha Rao', d, 'Available', 'Idle', '02:00:00'); add('Asha Rao', d, 'Paused', 'Break', '00:40:00'); });
  [2, 3, 4].forEach(d => { add('Ben Cole', d, 'Working', 'Talking', '05:00:00'); add('Ben Cole', d, 'Paused', 'Do Not Disturb', '03:20:00'); });
  [3, 4].forEach(d => { add('Cara Diaz', d, 'Working', 'Talking', '05:30:00'); add('Cara Diaz', d, 'Available', 'Idle', '02:00:00'); });
  return rows;
}
function standardPause() {
  return [
    { 'Agent name': 'Asha Rao', 'Pause reason': 'Break', 'Pause Duration (hh:mm:ss)': '02:00:00', 'Pause Count': 6 },
    { 'Agent name': 'Ben Cole', 'Pause reason': 'Do Not Disturb', 'Pause Duration (hh:mm:ss)': '10:00:00', 'Pause Count': 9 },
    { 'Agent name': 'Cara Diaz', 'Pause reason': 'Lunch', 'Pause Duration (hh:mm:ss)': '01:00:00', 'Pause Count': 2 },
  ];
}
function standardByDate() {
  const r = (day, tot, hd, ab, of, asa, lw, sl) => ({ 'Start time [US/Central]': `2026-03-0${day}T00:00:00-06:00`, 'End time': `2026-03-0${day}T23:59:59-06:00`,
    'Total calls count': tot, 'Handled count': hd, 'Abandoned count': ab, 'Outflowed system count': of,
    'Average speed of answer (s)': asa, 'Longest wait for answer (s)': lw, 'Met SL %': sl });
  return [r(2, 9, 6, 1, 2, 12, 40, '75'), r(3, 7, 5, 1, 1, 12, 35, '66.7'), r(4, 7, 4, 0, 3, 7, 8, '100')];
}

/** The full made-up production file set, ready for the "Production files" upload box. */
function standardProductionFiles() {
  return [
    csvFile('queue-caller-details.csv', standardQueueRows(), HEAD.queueDetails),
    csvFile('call-report-conversations.csv', standardCallLog(), HEAD.conversations),
    csvFile('agent-productivity.csv', standardProductivity(), HEAD.productivity),
    csvFile('individual-performance.csv', standardIndividual(), HEAD.individual),
    csvFile('agent-activity.csv', standardActivity(), HEAD.activity),
    csvFile('pause-usage.csv', standardPause(), HEAD.pause),
    csvFile('grouped-by-date.csv', standardByDate(), HEAD.byDate),
  ];
}

/* ---------- QA sheet (made-up) ---------- */
const QA_PARAMS = [
  ['Opening & Verification', 'Proper greeting with clinic/provider name', 5, 'Non Fatal Error'],
  ['Opening & Verification', 'Patient verification completed', 10, 'Non Fatal Error'],
  ['Communication Skills', 'Professional tone & empathy', 5, 'Non Fatal Error'],
  ['Communication Skills', 'Active listening / no interruptions', 5, 'Non Fatal Error'],
  ['Communication Skills', 'Clear pronunciation & pace', 5, 'Non Fatal Error'],
  ['Call Handling', 'Dead air management', 5, 'Non Fatal Error'],
  ['Call Handling', 'Long hold time control', 5, 'Non Fatal Error'],
  ['Call Handling', 'Periodic hold updates', 5, 'Non Fatal Error'],
  ['Call Handling', 'Call ownership', 5, 'Non Fatal Error'],
  ['Process Accuracy', 'Correct appointment handling', 10, 'Fatal Error'],
  ['Process Accuracy', 'Insurance EV Details Captured', 10, 'Non Fatal Error'],
  ['Process Accuracy', 'Correct documentation in EMR/PMS', 5, 'Non Fatal Error'],
  ['Resolution', 'Correct information shared', 10, 'Fatal Error'],
  ['Resolution', 'Call resolution achieved', 5, 'Fatal Error'],
  ['Resolution', 'Escalation protocol followed', 5, 'Non Fatal Error'],
  ['Closing', 'Recap & next steps', 3, 'Non Fatal Error'],
  ['Closing', 'Proper closing statement', 2, 'Non Fatal Error'],
];
const QA_HEAD = ['Manager', 'Supervisior ID', 'Supervisior', 'Client', 'Agent ID', 'Agent Name', 'Auditor ID', 'Auditor Name',
  'DOC (Date of Call)', 'DOA (Audit Date)', 'Audit Week', 'Audit Month', 'Caller ID', 'QA Status', 'Comments',
  'Feedback Shared', 'Feedback Date'].concat(QA_PARAMS.map(p => p[1]),
  ['Fatal Error', 'Non Fatal Error', 'Total Score', 'Total Error Count', 'Rebuttal Raised', 'Rebuttal Reason', 'Rebuttal Status']);

/** One audit row. missed = list of parameter names answered "N". Score follows the sheet rule: any fatal miss = 0. */
function qaRow(o = {}) {
  const missed = o.missed || [];
  const r = {
    'Manager': o.manager || 'Mira Shah', 'Supervisior ID': 'EMP900', 'Supervisior': o.sup == null ? 'Tariq Noor' : o.sup,
    'Client': o.client || 'Client One', 'Agent ID': 'EMP001', 'Agent Name': o.agent == null ? 'Asha Rao' : o.agent,
    'Auditor ID': 'EMP800', 'Auditor Name': o.auditor || 'Lena Kim',
    'DOC (Date of Call)': o.doc || '2026-03-02', 'DOA (Audit Date)': o.doa || '2026-03-03',
    'Audit Week': '', 'Audit Month': '', 'Caller ID': o.caller == null ? '' : o.caller,
    'QA Status': o.status == null ? (missed.length ? 'Error' : 'No Error') : o.status, 'Comments': o.comments || '',
    'Feedback Shared': o.fb == null ? '' : o.fb, 'Feedback Date': o.fbDate || '',
  };
  let fatal = 0, nonfatal = 0, lost = 0;
  QA_PARAMS.forEach(([, name, w, st]) => {
    const miss = missed.includes(name);
    r[name] = miss ? 'N' : 'Y';
    if (miss) { if (/^Fatal/.test(st)) fatal++; else nonfatal++; lost += w; }
  });
  r['Fatal Error'] = fatal; r['Non Fatal Error'] = nonfatal;
  r['Total Score'] = o.score !== undefined ? o.score : (fatal ? 0 : (100 - lost) / 100);
  r['Total Error Count'] = missed.length;
  r['Rebuttal Raised'] = o.reb || 'No'; r['Rebuttal Reason'] = o.rebReason || ''; r['Rebuttal Status'] = o.rebStatus || 'Not Required';
  return r;
}
/* Standard QA set: 8 audits, 3 agents.
 *  Asha Rao: 3 clean audits (100, 100, 100)
 *  Ben Cole: 3 audits: one fatal (score 0), one non-fatal Insurance miss (90), one clean (100)
 *  Cara Diaz: 2 audits: one with two non-fatal misses (5+5 -> 90), one fatal + non-fatal (0)
 */
function standardQARows() {
  return [
    qaRow({ agent: 'Asha Rao', doa: '2026-03-03', doc: '2026-03-02' }),
    qaRow({ agent: 'Asha Rao', doa: '2026-03-04', doc: '2026-03-03' }),
    qaRow({ agent: 'Asha Rao', doa: '2026-03-10', doc: '2026-03-09' }),
    qaRow({ agent: 'Ben Cole', doa: '2026-03-03', doc: '2026-03-02', missed: ['Correct appointment handling'], fb: 'Yes', fbDate: '2026-03-04' }),
    qaRow({ agent: 'Ben Cole', doa: '2026-03-04', doc: '2026-03-03', missed: ['Insurance EV Details Captured'], reb: 'Yes', rebReason: 'Details were captured', rebStatus: 'Accepted' }),
    qaRow({ agent: 'Ben Cole', doa: '2026-03-11', doc: '2026-03-10' }),
    qaRow({ agent: 'Cara Diaz', doa: '2026-03-04', doc: '2026-03-03', missed: ['Dead air management', 'Call ownership'], reb: 'Yes', rebReason: 'Hold was explained', rebStatus: 'Rejected' }),
    qaRow({ agent: 'Cara Diaz', doa: '2026-03-11', doc: '2026-03-10', missed: ['Correct information shared', 'Recap & next steps'] }),
  ];
}
const EXPECT_QA = {
  audits: 8,
  fatalErrors: 2, nonFatalErrors: 4, auditsScoredZero: 2,
  avgScore: (100 + 100 + 100 + 0 + 90 + 100 + 90 + 0) / 8,   // 72.5
  byAgent: { 'Asha Rao': 100, 'Ben Cole': (0 + 90 + 100) / 3, 'Cara Diaz': 45 },
  rebuttalsRaised: 2,
};
function qaCsvFile(rows, name = 'quality-audit-log.csv') { return csvFile(name, rows || standardQARows(), QA_HEAD); }

/** Build a real .xlsx workbook (Scoring Key + Master List + Quality Audit Log) as a file for upload.
 *  opts.params: override the scoring key rows. opts.dateCells: write audit dates as real Excel dates. */
function qaXlsxFile(rows, opts = {}) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const params = opts.params || QA_PARAMS;
  if (!opts.noKey) {
    const key = [['#', 'Category', 'Parameter', 'Description', 'Weightage', 'Status']]
      .concat(params.map((p, i) => [i + 1, p[0], p[1], 'made-up description', p[2], p[3]]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(key), 'Scoring Key');
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Employee ID', 'Full Name', 'Role'], ['EMP001', 'Asha Rao', 'Agent']]), 'Master List');
  const data = rows || standardQARows();
  const head = opts.head || QA_HEAD;
  const aoa = [['Audit Details'], head].concat(data.map(r => head.map(h => {
    const v = r[h];
    if (opts.dateCells && /^(DOC|DOA|Feedback Date)/.test(h) && /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) {
      const [y, m, d] = String(v).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12));
    }
    return v;
  })));
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: !!opts.dateCells });
  XLSX.utils.book_append_sheet(wb, ws, opts.sheetName || 'Quality Audit Log');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { name: opts.name || 'PCC_Quality_Sheet.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf };
}

/* ---------- browser ---------- */
let _browser = null;
async function getBrowser() { if (!_browser) _browser = await chromium.launch(); return _browser; }
async function closeBrowser() { if (_browser) { await _browser.close(); _browser = null; } }

/**
 * Open the app in a fresh, isolated browser context.
 * opts: { timezoneId, viewport, locale, blockNetwork (default true), xlsx (default 'local' | 'fail'), acceptDownloads }
 * Returns { page, context, errors, dialogs, requests }.
 *  errors   = uncaught page errors + console errors (ignoring blocked font requests)
 *  dialogs  = text of every alert/confirm the app raised (auto-dismissed)
 *  requests = every outside (non file://) request the page tried to make
 */
async function openApp(opts = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1400, height: 900 },
    timezoneId: opts.timezoneId || 'Asia/Kolkata',
    locale: opts.locale || 'en-IN',
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [], dialogs = [], requests = [];
  page.on('pageerror', e => errors.push('page error: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console error: ' + m.text()); });
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  // Never touch the outside world: fonts are blocked, the Excel reader is served from a local copy.
  await context.route(/^https?:\/\//, route => {
    const url = route.request().url();
    requests.push(url);
    if (/xlsx\.full\.min\.js/.test(url)) {
      if (opts.xlsx === 'fail') return route.abort();
      return route.fulfill({ path: XLSX_LIB, contentType: 'application/javascript' });
    }
    return route.abort();
  });
  if (opts.beforeLoad) await opts.beforeLoad(page, context);
  await page.goto(APP_URL);
  return { page, context, errors, dialogs, requests };
}

/** Put production CSV files into upload box 1 and wait for the dashboard to draw. */
async function loadProduction(page, files) {
  await page.setInputFiles('#fileInput', files || standardProductionFiles());
  await page.waitForFunction(() => !document.querySelector('.shell').classList.contains('pre-load') || document.querySelectorAll('#fileList .fl').length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(150);
}
/** Put a QA file (.csv or .xlsx) into upload box 2 and wait for it to be read. */
async function loadQuality(page, file) {
  const before = await page.evaluate(() => (typeof DS !== 'undefined' && DS.quality) ? DS.quality.length : -1);
  await page.setInputFiles('#fileInputQ', file || qaCsvFile());
  await page.waitForFunction(b => (typeof DS !== 'undefined' && DS.quality && DS.quality.length !== b) || window.__qaLoadFailed, before, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(200);
}
/** Show one of the app's sections (exec, overview, coverage, agents, volume, voice, insights, quality, report). */
async function show(page, id) { await page.evaluate(v => switchView(v), id); await page.waitForTimeout(60); }

/** Text of a KPI card found by its label, inside a section. Returns { value, foot } or null. */
async function kpi(page, viewId, label) {
  return page.evaluate(([v, l]) => {
    const cards = [...document.querySelectorAll('#v-' + v + ' .kpi')];
    const c = cards.find(k => { const el = k.querySelector('.lab'); return el && el.textContent.trim() === l; });
    if (!c) return null;
    const val = c.querySelector('.val'), foot = c.querySelector('.foot');
    return { value: val ? val.textContent.trim() : '', foot: foot ? foot.textContent.trim() : '' };
  }, [viewId, label]);
}
/** Read an HTML table as rows of cell text. selector should match one <table>. */
async function tableRows(page, selector) {
  return page.evaluate(sel => {
    const t = document.querySelector(sel); if (!t) return null;
    return [...t.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim()));
  }, selector);
}
/** Find the table that follows a heading/card title containing the given text, inside a section. */
async function tableAfterTitle(page, viewId, titleText) {
  return page.evaluate(([v, t]) => {
    const root = document.querySelector('#v-' + v); if (!root) return null;
    const heads = [...root.querySelectorAll('h3,h4')].filter(h => h.textContent.includes(t));
    for (const h of heads) {
      let tbl = null;
      const card = h.closest('.card');
      if (card) tbl = card.querySelector('table');
      if (!tbl) { let n = h.nextElementSibling; while (n && !tbl) { tbl = n.matches('table') ? n : n.querySelector('table'); n = n.nextElementSibling; } }
      if (tbl) return [...tbl.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim()));
    }
    return null;
  }, [viewId, titleText]);
}
/** Click something that starts a download and return the downloaded text plus its file name. */
async function download(page, clickFn) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), clickFn()]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), text: fs.readFileSync(p, 'utf8') };
}
/** Parse CSV text (handles quotes) into an array of arrays. */
function parseCSVText(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

module.exports = {
  ROOT, APP_URL, HEAD, QA_PARAMS, QA_HEAD,
  toCSV, csvFile, rawFile, qRow, cRow, qaRow,
  standardQueueRows, standardCallLog, standardProductivity, standardIndividual, standardActivity, standardPause, standardByDate,
  standardProductionFiles, standardQARows, qaCsvFile, qaXlsxFile,
  EXPECT_QUEUE, EXPECT_CALLS, EXPECT_QA,
  openApp, closeBrowser, loadProduction, loadQuality, show, kpi, tableRows, tableAfterTitle, download, parseCSVText,
};
