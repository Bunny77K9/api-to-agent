/**
 * ASCEND Session 3 — MODEL CONNECTIVITY TEST
 *
 *   node agent/test-model.js
 *
 * Run this BEFORE your session. It checks three things in order, and each one
 * fails with a message that tells you what to change:
 *
 *   1. can we reach the endpoint at all?
 *   2. does the key and deployment work?
 *   3. does the model actually support tool calling? (the agent needs this)
 *
 * It never prints your key.
 */

const https = require('https');

const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_KEY      = process.env.AZURE_OPENAI_KEY;
const AZURE_DEPLOY   = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini';
const AZURE_VERSION  = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
const OAI_BASE       = process.env.OPENAI_BASE_URL;
const OAI_KEY        = process.env.OPENAI_API_KEY;
const OAI_MODEL      = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const MODE = AZURE_ENDPOINT && AZURE_KEY ? 'azure'
           : OAI_BASE && OAI_KEY ? 'openai-compatible'
           : 'none';

if (MODE === 'none') {
  console.log('\n  No model settings found.\n');
  console.log('  That is fine — the agent will use its offline planner and every demo works.');
  console.log('  To test a real model, set the variables from the README first.\n');
  process.exit(0);
}

console.log('\n  Checking your model settings');
console.log('  ' + '-'.repeat(52));
if (MODE === 'azure') {
  console.log(`  endpoint     ${AZURE_ENDPOINT}`);
  console.log(`  deployment   ${AZURE_DEPLOY}`);
  console.log(`  api-version  ${AZURE_VERSION}`);
} else {
  console.log(`  base url     ${OAI_BASE}`);
  console.log(`  model        ${OAI_MODEL}`);
}
console.log(`  key          ${'*'.repeat(12)} (${(MODE === 'azure' ? AZURE_KEY : OAI_KEY).length} chars)`);
console.log('  ' + '-'.repeat(52) + '\n');

const TOOL = [{
  type: 'function',
  function: {
    name: 'get_order',
    description: 'Look up one order by its number.',
    parameters: { type: 'object', properties: { orderId: { type: 'number' } }, required: ['orderId'] }
  }
}];

function call(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    let opts;
    if (MODE === 'azure') {
      const u = new URL(AZURE_ENDPOINT);
      opts = { hostname: u.hostname, port: u.port || 443,
               path: `/openai/deployments/${AZURE_DEPLOY}/chat/completions?api-version=${AZURE_VERSION}`,
               method: 'POST',
               headers: { 'Content-Type': 'application/json', 'api-key': AZURE_KEY,
                          'Content-Length': Buffer.byteLength(payload) } };
    } else {
      const u = new URL(OAI_BASE.replace(/\/$/, '') + '/chat/completions');
      opts = { hostname: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST',
               headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OAI_KEY}`,
                          'Content-Length': Buffer.byteLength(payload) } };
    }
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let data;
        try { data = JSON.parse(raw); } catch { return reject(new Error(`status ${res.statusCode}: ${raw.slice(0, 300)}`)); }
        if (data.error) return reject(Object.assign(new Error(data.error.message), { status: res.statusCode }));
        resolve(data);
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timed out after 30s')); });
    req.write(payload);
    req.end();
  });
}

function advise(e) {
  const m = e.message || '';
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'The hostname did not resolve. Check the endpoint URL for typos, and check your internet.';
  if (/temperature/i.test(m))        return 'Unset AGENT_TEMPERATURE. This model only accepts its default temperature.';
  if (/max_tokens/i.test(m))         return 'This model wants max_completion_tokens instead of max_tokens.';
  if (e.status === 401)              return 'The key is wrong, or it belongs to a different resource. Copy it again from the portal.';
  if (e.status === 404)              return 'The deployment name or api-version is wrong. The deployment name is what YOU named it in the portal, not the model name.';
  if (e.status === 429)              return 'Rate limited or out of quota. For the session, use the offline planner instead.';
  if (/tool|function/i.test(m))      return 'This deployment may not support tool calling. The agent needs it — try a different model.';
  return 'Check the endpoint, deployment name and api-version against the Azure portal.';
}

(async () => {
  try {
    process.stdout.write('  1. basic chat request      ... ');
    const basic = await call({ messages: [{ role: 'user', content: 'Reply with the single word: ready' }] });
    console.log('ok  ->  "' + (basic.choices[0].message.content || '').trim().slice(0, 40) + '"');
  } catch (e) {
    console.log('FAILED');
    console.log(`\n     ${e.message}\n`);
    console.log(`     ${advise(e)}\n`);
    process.exit(1);
  }

  try {
    process.stdout.write('  2. tool calling            ... ');
    const withTools = await call({
      messages: [
        { role: 'system', content: 'Use the tools to look things up. Never guess.' },
        { role: 'user', content: 'Where is order 1042?' }
      ],
      tools: TOOL,
      tool_choice: 'auto'
    });
    const tc = withTools.choices[0].message.tool_calls;
    if (!tc || !tc.length) {
      console.log('NO TOOL CALL');
      console.log('\n     The model answered without calling the tool. The agent needs tool calling.');
      console.log('     Try a different deployment, or use the offline planner for the session.\n');
      process.exit(1);
    }
    console.log(`ok  ->  ${tc[0].function.name}(${tc[0].function.arguments})`);
  } catch (e) {
    console.log('FAILED');
    console.log(`\n     ${e.message}\n`);
    console.log(`     ${advise(e)}\n`);
    process.exit(1);
  }

  console.log('\n  Both checks passed. Start the agent and it will use this model.\n');
})();
