import { api } from '../api.js';
import { esc, toast } from '../dom.js';

export const title = 'Social Studio';

const PLATFORMS = [
  ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'],
  ['x', 'X'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['threads', 'Threads'], ['other', 'Other'],
];
const ACCOUNT_PROFILES = [
  { profileId: 'facebook:softly-bot', platform: 'facebook', name: 'Softly Bot', handle: 'Softly Bot' },
  { profileId: 'instagram:softly1810', platform: 'instagram', name: 'Softly Digitals', handle: '@softly1810' },
  { profileId: 'tiktok:softly1810', platform: 'tiktok', name: 'Softly Digitals', handle: '@Softly1810' },
  { profileId: 'linkedin:emmanuel-iyke', platform: 'linkedin', name: 'Emmanuel Iyke', handle: 'Emmanuel Iyke' },
];
const localTime = (value) => value ? new Date(value).toLocaleString() : 'Not set';
const safe = (value) => esc(String(value ?? ''));
const safeHref = (value) => { try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) ? esc(url.href) : ''; } catch { return ''; } };

function platformChecks(selected = ['facebook', 'instagram', 'linkedin']) {
  return PLATFORMS.map(([id, label]) => `<label class="social-platform"><input type="checkbox" name="social-platform" value="${id}" ${selected.includes(id) ? 'checked' : ''}><span>${label}</span></label>`).join('');
}
function accountChecks() {
  return ACCOUNT_PROFILES.map((account) => '<label class="social-platform"><input type="checkbox" name="social-account" value="' + account.profileId + '" data-platform="' + account.platform + '" ' + (['facebook', 'instagram', 'linkedin'].includes(account.platform) ? 'checked' : '') + '><span>' + account.platform + ': ' + account.handle + '</span></label>').join('');
}

export async function render(container) {
  let summary = { total: 0, drafts: 0, scheduled: 0, published: 0, failed: 0, connectors: [] };
  let posts = [];
  let engagementItems = [];
  try {
    [summary, posts] = await Promise.all([api.get('/api/social/summary'), api.get('/api/social/posts')]);
  } catch (error) {
    container.innerHTML = `<section class="card"><h2>Social Studio unavailable</h2><p class="empty">${safe(error.message)}</p><p>Check XOFT server connectivity and API access.</p></section>`;
    return;
  }

  container.innerHTML = `
    <section class="plugin-hero">
      <div class="plugin-hero-copy"><span class="plugin-kicker">XOFT / PERSONAL ASSISTANT</span><h2>Social Studio</h2><p>Plan content, create drafts, schedule posts, and track what actually published. XOFT only publishes through a configured, working connector after you approve the post.</p></div>
      <div class="plugin-hero-stats"><div><strong id="social-drafts">${summary.drafts}</strong><span>DRAFTS</span></div><div><strong id="social-scheduled">${summary.scheduled}</strong><span>SCHEDULED</span></div><div><strong id="social-published">${summary.published}</strong><span>PUBLISHED</span></div></div>
    </section>
    <section class="card social-handle-dashboard">
      <div class="plugin-section-head"><div><span class="plugin-kicker">MULTI-ACCOUNT CONTROL ROOM</span><h2>Social handles & autonomous AI</h2></div><span class="plugin-category">Independent control per account</span></div>
      <p>Register as many social handles as you need. XOFT can inspect recent content through a configured connector, learn the account's recurring themes and style, then generate original posts on the account's own schedule. Enable autonomy separately for each handle. The red KILL button immediately disables future runs and cancels queued scheduled posts for that handle.</p>
      <div class="plugin-form-grid">
        <div class="form-row"><label for="social-handle-platform">PLATFORM</label><select id="social-handle-platform">${PLATFORMS.map(([id,label]) => `<option value="${id}">${label}</option>`).join('')}</select></div>
        <div class="form-row"><label for="social-handle-name">HANDLE / PROFILE URL</label><input id="social-handle-name" maxlength="180" placeholder="@yourbrand or profile URL" /></div>
        <div class="form-row"><label for="social-handle-display">DISPLAY NAME</label><input id="social-handle-display" maxlength="180" placeholder="Brand or profile name" /></div>
        <div class="form-row"><label for="social-handle-connector">CONNECTOR</label><select id="social-handle-connector"><option value="">Choose connector</option>${summary.connectors.map((x) => `<option value="${safe(x.id)}">${safe(x.name)} (${safe(x.id)})</option>`).join('')}</select></div>
        <div class="form-row"><label for="social-handle-read-tool">READ RECENT POSTS TOOL</label><input id="social-handle-read-tool" list="social-tool-options" maxlength="120" placeholder="Exact discovered tool name" /></div>
        <div class="form-row"><label for="social-handle-publish-tool">PUBLISH POST TOOL</label><input id="social-handle-publish-tool" list="social-tool-options" maxlength="120" placeholder="Exact discovered tool name" /></div>
        <div class="form-row"><label for="social-handle-goals">CONTENT GOAL</label><input id="social-handle-goals" maxlength="1000" value="Build trust and attract relevant customers" /></div>
        <div class="form-row"><label for="social-handle-tone">BRAND VOICE</label><input id="social-handle-tone" maxlength="300" value="Professional, helpful and clear" /></div>
        <div class="form-row"><label for="social-handle-interval">AUTONOMOUS POST INTERVAL (HOURS)</label><input id="social-handle-interval" type="number" min="12" max="168" value="24" /></div>
        <div class="form-row"><label for="social-handle-owner">OWNER CONFIRMATION NAME</label><input id="social-handle-owner" maxlength="120" placeholder="Required to enable autonomous publishing" /></div>
      </div>
      <div class="form-row"><label for="social-handle-context">CONFIRMED BRAND FACTS / BOUNDARIES</label><textarea id="social-handle-context" rows="3" maxlength="3000" placeholder="What this brand offers, target audience, approved links, facts and claims XOFT must not invent."></textarea></div>
      <div class="social-actions"><button type="button" id="social-handle-discover">Discover tools for selected connector</button><button type="button" id="social-handle-add" class="primary">＋ Add social handle</button><button type="button" id="social-handle-refresh">Refresh handles</button></div>
      <p id="social-handle-feedback" class="plugin-safety-note" aria-live="polite">Autonomous posting starts OFF. Choose the exact account-reading and publishing tools from your connector.</p>
      <div id="social-handle-list" class="social-list"><div class="empty">Loading social handles…</div></div>
      <div class="plugin-safety-note"><strong>Autonomy boundary:</strong> XOFT learns from the content the connected tool actually returns. It does not bypass platform permissions or infer that a handle is authenticated. When autonomy is enabled, it may publish original posts without per-post approval, but only for that specific handle. The kill switch disables future runs; a post already accepted by the platform cannot be recalled by XOFT.</div>
    </section>
    <section class="card">
      <div class="plugin-section-head"><div><span class="plugin-kicker">CONTENT WORKBENCH</span><h2>Create a post</h2></div><span class="plugin-category">Draft first · approve before publishing</span></div>
      <div class="plugin-form-grid">
        <div class="form-row"><label for="social-brief">WHAT SHOULD XOFT TALK ABOUT?</label><input id="social-brief" maxlength="1200" placeholder="e.g. Promote Softly Digitals' website and chatbot services" /></div>
        <div class="form-row"><label for="social-goal">POST GOAL</label><select id="social-goal"><option value="engagement">Build engagement</option><option value="leads">Generate qualified leads</option><option value="educate">Educate the audience</option><option value="announce">Make an announcement</option><option value="promote">Promote a service</option></select></div>
        <div class="form-row"><label for="social-tone">BRAND VOICE</label><select id="social-tone"><option>Professional and clear</option><option>Friendly and conversational</option><option>Bold and persuasive</option><option>Educational and practical</option><option>Premium and minimal</option></select></div>
        <div class="form-row"><label for="social-cta">CALL TO ACTION (OPTIONAL)</label><input id="social-cta" maxlength="240" placeholder="e.g. Send us a message for a quote" /></div>
      </div>
      <div class="form-row"><label>PLATFORMS</label><div class="social-platforms">${platformChecks()}</div></div>
      <div class="form-row"><label>TARGET ACCOUNTS / PROFILES</label><div class="social-platforms">${accountChecks()}</div><p class="plugin-safety-note">These are saved profile targets, not proof of login or authorization. XOFT passes the selected profile IDs to your configured publishing connector.</p></div>
      <div class="form-row"><label for="social-content">POST COPY</label><textarea id="social-content" rows="7" maxlength="10000" placeholder="Generate a draft or write your post here…"></textarea></div>
      <div class="form-row"><label for="social-hashtags">HASHTAGS (comma-separated, optional)</label><input id="social-hashtags" maxlength="500" placeholder="WebDevelopment, BusinessGrowth, AI" /></div>
      <div class="social-actions"><button type="button" id="social-generate" class="primary">✦ Generate content with XOFT</button><button type="button" id="social-save">Save as draft</button></div>
      <p id="social-feedback" class="plugin-safety-note" aria-live="polite">AI content generation uses your configured model provider. Review claims, links, prices, and brand details before posting.</p>
    </section>
    <section class="card">
      <div class="plugin-section-head"><div><span class="plugin-kicker">PUBLISHING CONNECTION</span><h2>Schedule & approve</h2></div></div>
      <div class="plugin-form-grid">
        <div class="form-row"><label for="social-post-select">SAVED DRAFT</label><select id="social-post-select"><option value="">Save a draft first</option></select></div>
        <div class="form-row"><label for="social-date">PUBLISH AT (YOUR DEVICE TIME)</label><input id="social-date" type="datetime-local" /></div>
        <div class="form-row"><label for="social-connector">PUBLISHING CONNECTOR</label><select id="social-connector"><option value="">Choose connector</option>${summary.connectors.map((c) => `<option value="${safe(c.id)}">${safe(c.name)} (${safe(c.id)})</option>`).join('')}</select></div>
        <div class="form-row"><label for="social-tool">PUBLISH TOOL NAME</label><input id="social-tool" list="social-tool-options" maxlength="120" placeholder="Discover tools, then choose the publish tool" /><datalist id="social-tool-options"></datalist></div>
        <div class="form-row"><label for="social-approver">APPROVED BY</label><input id="social-approver" maxlength="120" placeholder="Your name" /></div>
        <div class="form-row"><label for="social-approval-note">APPROVAL NOTE</label><input id="social-approval-note" maxlength="1000" placeholder="I reviewed this copy and authorize publishing" /></div>
      </div>
      <div class="form-row"><label for="social-payload">CONNECTOR EXTRA INPUT (JSON, optional)</label><textarea id="social-payload" rows="2" placeholder="{}"></textarea></div>
      <div class="social-actions"><button type="button" id="social-discover">Discover connector tools</button><button type="button" id="social-schedule" class="primary">Approve & schedule</button><button type="button" id="social-refresh">Refresh calendar</button></div><p id="social-connector-info" class="plugin-safety-note" aria-live="polite">Choose a configured connector to inspect its available publishing tools.</p>
      <p class="plugin-safety-note">Connect a publishing service through Plugins & Apps → server connector configuration. XOFT does not have native direct posting credentials for every social network. Scheduled publishing requires the server to stay online and the connector's tool to accept the post payload.</p>
    </section>
    <section class="card"><div class="plugin-section-head"><div><span class="plugin-kicker">CONTENT CALENDAR</span><h2>Post queue</h2></div><select id="social-filter"><option value="">All posts</option><option value="draft">Drafts</option><option value="scheduled">Scheduled</option><option value="published">Published</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select></div><div id="social-list" class="social-list"><div class="empty">Loading calendar…</div></div></section>
    <section class="card">
      <div class="plugin-section-head"><div><span class="plugin-kicker">COMMUNITY MANAGEMENT</span><h2>Comments & direct messages</h2></div><span class="plugin-category">Inbox · AI reply drafts · approval before sending</span></div>
      <p>Sync inbound comments and DMs from a connected account, draft helpful replies with XOFT, then approve the exact reply before it is sent. This requires a connector with permission to read the relevant inbox and reply on your behalf.</p>
      <div class="plugin-form-grid">
        <div class="form-row"><label for="social-platform-inbox">PLATFORM</label><select id="social-platform-inbox"><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option><option value="x">X</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="threads">Threads</option></select></div>
        <div class="form-row"><label for="social-comments-tool">COMMENTS READ TOOL</label><input id="social-comments-tool" list="social-tool-options" placeholder="Optional exact tool name" /></div>
        <div class="form-row"><label for="social-dms-tool">DM INBOX READ TOOL</label><input id="social-dms-tool" list="social-tool-options" placeholder="Optional exact tool name" /></div>
        <div class="form-row"><label for="social-reply-tool">COMMENT/DM REPLY TOOL</label><input id="social-reply-tool" list="social-tool-options" placeholder="Exact connector tool to send a reply" /></div>
        <div class="form-row"><label for="social-reply-approver">APPROVED BY</label><input id="social-reply-approver" maxlength="120" placeholder="Your name" /></div>
        <div class="form-row"><label for="social-reply-approval-note">APPROVAL NOTE</label><input id="social-reply-approval-note" maxlength="1000" placeholder="I reviewed and approve this exact reply" /></div>
      </div>
      <div class="social-actions"><button type="button" id="social-engagement-discover">Discover inbox/reply tools</button><button type="button" id="social-engagement-sync" class="primary">Sync comments & DMs</button><button type="button" id="social-engagement-refresh">Refresh inbox</button></div>
      <p id="social-engagement-feedback" class="plugin-safety-note" aria-live="polite">Inbox sync imports only records returned by your connector. Nothing is automatically sent.</p>
      <div class="plugin-form-grid">
        <div class="form-row"><label for="social-engagement-select">INBOX ITEM</label><select id="social-engagement-select"><option value="">Select a comment or DM</option></select></div>
        <div class="form-row"><label for="social-reply-context">OPTIONAL BUSINESS CONTEXT</label><input id="social-reply-context" maxlength="2000" placeholder="Services, policies, confirmed prices, response style" /></div>
      </div>
      <div class="form-row"><label for="social-reply-content">REPLY DRAFT</label><textarea id="social-reply-content" rows="4" maxlength="5000" placeholder="Select an inbox item, then generate or edit a reply…"></textarea></div>
      <div class="social-actions"><button type="button" id="social-reply-generate" class="primary">Generate reply with XOFT</button><button type="button" id="social-reply-send">Approve & send reply</button><button type="button" id="social-engagement-ignore">Mark ignored</button></div>
      <div id="social-engagement-list" class="social-list"><div class="empty">Loading inbox…</div></div>
    </section>
  `;

  const $ = (id) => container.querySelector('#' + id);
  const selectedPlatforms = () => [...container.querySelectorAll('input[name="social-platform"]:checked')].map((el) => el.value);
  const selectedTargetAccounts = () => [...container.querySelectorAll('input[name="social-account"]:checked')].map((el) => ACCOUNT_PROFILES.find((account) => account.profileId === el.value)).filter((account) => account && selectedPlatforms().includes(account.platform));
  const setFeedback = (message) => { $('social-feedback').textContent = message; };
  let socialHandles = [];
  let editingHandleId = null;
  const setHandleFeedback = (message) => { $('social-handle-feedback').textContent = message; };
  const resetHandleForm = () => {
    editingHandleId = null;
    $('social-handle-add').textContent = '＋ Add social handle';
    ['social-handle-name','social-handle-display','social-handle-read-tool','social-handle-publish-tool','social-handle-context'].forEach((id) => { $(id).value = ''; });
    $('social-handle-goals').value = 'Build trust and attract relevant customers';
    $('social-handle-tone').value = 'Professional, helpful and clear';
    $('social-handle-interval').value = '24';
  };
  const renderHandleList = () => {
    $('social-handle-list').innerHTML = socialHandles.length ? socialHandles.map((item) => {
      let style = 'Not learned yet';
      try { if (item.styleProfile) { const profile = JSON.parse(item.styleProfile); style = safe(profile.summary || profile.voice || 'Style profile saved'); } } catch { style = safe(item.styleProfile.slice(0, 180)); }
      return `<article class="social-post social-handle-card">
        <div class="social-post-head"><div><strong>${safe(item.displayName || item.handle)}</strong><div class="plugin-results">${safe(item.platform)} · ${safe(item.handle)} · ${item.learnedExamples || 0} examples learned</div></div><span class="plugin-category">${item.autoEnabled ? 'AUTOPILOT ON' : 'AUTOPILOT OFF'}</span></div>
        <p><strong>Style:</strong> ${style}</p>
        <p class="plugin-results">Next run: ${safe(localTime(item.nextRunAt))} · Last scan: ${safe(localTime(item.lastScanAt))}</p>
        ${item.lastError ? `<p class="social-error">Last issue: ${safe(item.lastError)}</p>` : ''}
        <div class="social-actions">
          <button type="button" data-handle-action="edit" data-handle-id="${safe(item.id)}">Edit settings</button>
          <button type="button" data-handle-action="learn" data-handle-id="${safe(item.id)}">Learn from posts</button>
          <button type="button" data-handle-action="run" data-handle-id="${safe(item.id)}" ${item.autoEnabled ? '' : 'disabled'}>Run now</button>
          <button type="button" data-handle-action="autonomy" data-handle-id="${safe(item.id)}">${item.autoEnabled ? 'Pause autonomy' : 'Enable autonomy'}</button>
          <button type="button" class="danger" data-handle-action="kill" data-handle-id="${safe(item.id)}">⛔ KILL THIS HANDLE</button>
        </div>
      </article>`;
    }).join('') : '<div class="empty">No handles added yet. Add your first handle above. You can register multiple profiles on the same or different platforms.</div>';
  };
  const refreshHandles = async () => {
    socialHandles = await api.get('/api/social/handles');
    renderHandleList();
  };
  const refresh = async () => {
    [summary, posts] = await Promise.all([api.get('/api/social/summary'), api.get('/api/social/posts')]);
    $('social-drafts').textContent = summary.drafts;
    $('social-scheduled').textContent = summary.scheduled;
    $('social-published').textContent = summary.published;
    const current = $('social-post-select').value;
    $('social-post-select').innerHTML = '<option value="">Select a draft</option>' + posts.filter((p) => ['draft', 'failed'].includes(p.status)).map((p) => `<option value="${safe(p.id)}">${safe(p.title)} · ${safe(p.status)}</option>`).join('');
    if (posts.some((p) => p.id === current)) $('social-post-select').value = current;
    renderList();
  };
  const renderList = () => {
    const filter = $('social-filter').value;
    const visible = posts.filter((p) => !filter || p.status === filter);
    $('social-list').innerHTML = visible.length ? visible.map((p) => `
      <article class="social-post">
        <div class="social-post-head"><div><strong>${safe(p.title)}</strong><div class="plugin-results">${safe(p.platforms.join(', '))} · ${safe(localTime(p.scheduledAt))}</div>${p.targetAccounts?.length ? `<div class="plugin-results">Targets: ${safe(p.targetAccounts.map((account) => account.handle || account.name || account.profileId).join(', '))}</div>` : ''} </div><span class="plugin-category">${safe(p.status)}</span></div>
        <p>${safe(p.content.slice(0, 420))}${p.content.length > 420 ? '…' : ''}</p>
        ${p.lastError ? `<p class="social-error">Last error: ${safe(p.lastError)}</p>` : ''}
        ${p.publishedAt ? `<p class="plugin-safety-note">Provider confirmed at ${safe(localTime(p.publishedAt))}. Verify the live post URL in the connected service.</p>` : ''}
        <div class="social-actions">${['draft','scheduled','failed'].includes(p.status) ? `<button type="button" data-social-cancel="${safe(p.id)}">Cancel</button>` : ''}</div>
      </article>`).join('') : '<div class="empty">No posts match this filter yet.</div>';
  };

  $('social-generate').addEventListener('click', async () => {
    const brief = $('social-brief').value.trim();
    if (!brief) return setFeedback('Add a topic or goal first.');
    $('social-generate').disabled = true; setFeedback('XOFT is preparing a draft…');
    try {
      const result = await api.post('/api/social/generate-content', { brief, goal: $('social-goal').value, tone: $('social-tone').value, callToAction: $('social-cta').value, platforms: selectedPlatforms() });
      $('social-content').value = result.content ?? '';
      if (result.hashtags?.length) $('social-hashtags').value = result.hashtags.join(', ');
      setFeedback('Draft generated. Check the wording and factual claims before saving.');
    } catch (error) { setFeedback('Content generation failed: ' + error.message); }
    finally { $('social-generate').disabled = false; }
  });
  $('social-post-select').addEventListener('change', () => {
    const selected = posts.find((item) => item.id === $('social-post-select').value);
    if (!selected) return;
    $('social-brief').value = selected.title ?? '';
    $('social-content').value = selected.content ?? '';
    $('social-hashtags').value = (selected.hashtags ?? []).join(', ');
    container.querySelectorAll('input[name="social-platform"]').forEach((el) => { el.checked = selected.platforms.includes(el.value); });
    const targetIds = new Set((selected.targetAccounts ?? []).map((account) => account.profileId));
    container.querySelectorAll('input[name="social-account"]').forEach((el) => { el.checked = targetIds.size ? targetIds.has(el.value) : selected.platforms.includes(el.dataset.platform); });
    setFeedback('Loaded saved post. Make changes, then save to update the selected draft.');
  });
  $('social-save').addEventListener('click', async () => {
    try {
      const content = $('social-content').value.trim();
      if (!content) return setFeedback('Write or generate the post copy first.');
      const hashtags = $('social-hashtags').value.split(',').map((x) => x.trim()).filter(Boolean);
      const payload = { title: $('social-brief').value.trim(), content, platforms: selectedPlatforms(), targetAccounts: selectedTargetAccounts(), hashtags };
      const selectedId = $('social-post-select').value;
      const editable = posts.find((item) => item.id === selectedId && ['draft', 'failed'].includes(item.status));
      const post = editable
        ? await api.patch('/api/social/posts/' + encodeURIComponent(editable.id), payload)
        : await api.post('/api/social/posts', payload);
      setFeedback(editable ? 'Selected draft updated.' : 'Draft saved. Choose it below to schedule after review.');
      await refresh(); $('social-post-select').value = post.id;
      toast(editable ? 'Social post draft updated' : 'Social post draft saved');
    } catch (error) { setFeedback('Could not save draft: ' + error.message); }
  });
  $('social-discover').addEventListener('click', async () => {
    const connectorId = $('social-connector').value;
    if (!connectorId) return ($('social-connector-info').textContent = 'Choose a configured connector first.');
    $('social-discover').disabled = true;
    $('social-connector-info').textContent = 'Discovering connector tools…';
    try {
      const discovered = await api.get('/api/connectors/' + encodeURIComponent(connectorId) + '/tools');
      const tools = Array.isArray(discovered?.tools) ? discovered.tools : Array.isArray(discovered?.result?.tools) ? discovered.result.tools : [];
      $('social-tool-options').innerHTML = tools.map((tool) => {
        const name = typeof tool === 'string' ? tool : tool.name;
        return name ? '<option value="' + safe(name) + '">' : '';
      }).join('');
      $('social-connector-info').textContent = tools.length
        ? 'Found ' + tools.length + ' tool(s). Select the tool that actually publishes posts; not every connector tool is a publisher.'
        : 'Connector response received. Review tool names: ' + JSON.stringify(discovered).slice(0, 1000);
    } catch (error) {
      $('social-connector-info').textContent = 'Tool discovery failed: ' + error.message;
    } finally { $('social-discover').disabled = false; }
  });
  $('social-schedule').addEventListener('click', async () => {
    const id = $('social-post-select').value;
    if (!id) return setFeedback('Save and select a draft first.');
    try {
      const scheduledAt = new Date($('social-date').value).toISOString();
      const publishInput = $('social-payload').value.trim() ? JSON.parse($('social-payload').value) : {};
      const result = await api.post('/api/social/posts/' + encodeURIComponent(id) + '/schedule', {
        scheduledAt, connectorId: $('social-connector').value, publishTool: $('social-tool').value,
        approvedBy: $('social-approver').value, approvalNote: $('social-approval-note').value, publishInput,
      });
      setFeedback(result.note ?? 'Post scheduled.');
      await refresh();
    } catch (error) { setFeedback('Could not schedule: ' + error.message); }
  });
  $('social-refresh').addEventListener('click', () => refresh().catch((e) => setFeedback(e.message)));
  $('social-filter').addEventListener('change', renderList);
  $('social-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-social-cancel]');
    if (!button) return;
    try {
      await api.post('/api/social/posts/' + encodeURIComponent(button.dataset.socialCancel) + '/cancel', {});
      await refresh(); toast('Post cancelled');
    } catch (error) { setFeedback('Cancel failed: ' + error.message); }
  });


  $('social-handle-discover').addEventListener('click', async () => {
    const connectorId = $('social-handle-connector').value;
    if (!connectorId) return setHandleFeedback('Choose a configured connector first.');
    $('social-handle-discover').disabled = true;
    setHandleFeedback('Discovering connector tools…');
    try {
      const discovered = await api.get('/api/connectors/' + encodeURIComponent(connectorId) + '/tools');
      const tools = Array.isArray(discovered?.tools) ? discovered.tools : Array.isArray(discovered?.result?.tools) ? discovered.result.tools : [];
      const names = tools.map((tool) => typeof tool === 'string' ? tool : tool.name).filter(Boolean);
      $('social-tool-options').innerHTML = names.map((name) => '<option value="' + safe(name) + '">').join('');
      const choose = (patterns) => names.find((name) => patterns.some((pattern) => pattern.test(name))) ?? '';
      if (!$('social-handle-read-tool').value) $('social-handle-read-tool').value = choose([/(?:list|read|fetch|get|search).*(post|content|feed|timeline)/i, /(post|content|feed|timeline).*(list|read|fetch|get)/i]);
      if (!$('social-handle-publish-tool').value) $('social-handle-publish-tool').value = choose([/(publish|create|schedule|send).*(post|content)/i, /(post|content).*(publish|create|send)/i]);
      setHandleFeedback(names.length ? 'Found ' + names.length + ' tool(s). Confirm that the chosen reader returns recent posts for this exact account and the publisher sends to the correct handle.' : 'No tools returned by this connector.');
    } catch (error) { setHandleFeedback('Tool discovery failed: ' + error.message); }
    finally { $('social-handle-discover').disabled = false; }
  });
  $('social-handle-add').addEventListener('click', async () => {
    const handle = $('social-handle-name').value.trim();
    if (!handle) return setHandleFeedback('Enter the social handle or profile URL first.');
    const payload = {
      platform: $('social-handle-platform').value, handle,
      displayName: $('social-handle-display').value.trim() || handle,
      connectorId: $('social-handle-connector').value,
      readTool: $('social-handle-read-tool').value.trim(),
      publishTool: $('social-handle-publish-tool').value.trim(),
      goals: $('social-handle-goals').value.trim(),
      tone: $('social-handle-tone').value.trim(),
      intervalHours: Number($('social-handle-interval').value) || 24,
      brandContext: $('social-handle-context').value.trim(),
    };
    $('social-handle-add').disabled = true;
    try {
      if (editingHandleId) {
        await api.patch('/api/social/handles/' + encodeURIComponent(editingHandleId), payload);
        setHandleFeedback('Handle settings saved. Autonomy state was not changed.');
      } else {
        await api.post('/api/social/handles', payload);
        setHandleFeedback('Handle added. Autonomy is OFF until you configure the tools and explicitly enable it.');
      }
      resetHandleForm();
      await refreshHandles();
      toast(editingHandleId ? 'Social handle updated' : 'Social handle added');
    } catch (error) { setHandleFeedback('Could not save handle: ' + error.message); }
    finally { $('social-handle-add').disabled = false; }
  });
  $('social-handle-refresh').addEventListener('click', () => refreshHandles().catch((error) => setHandleFeedback('Could not refresh handles: ' + error.message)));
  $('social-handle-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-handle-action]');
    if (!button) return;
    const id = button.dataset.handleId;
    const action = button.dataset.handleAction;
    const item = socialHandles.find((entry) => entry.id === id);
    if (!item) return;
    if (action === 'edit') {
      editingHandleId = id;
      $('social-handle-add').textContent = 'Save handle settings';
      $('social-handle-platform').value = item.platform;
      $('social-handle-name').value = item.handle;
      $('social-handle-display').value = item.displayName || '';
      $('social-handle-connector').value = item.connectorId || '';
      $('social-handle-read-tool').value = item.readTool || '';
      $('social-handle-publish-tool').value = item.publishTool || '';
      $('social-handle-goals').value = item.goals || '';
      $('social-handle-tone').value = item.tone || '';
      $('social-handle-interval').value = item.intervalHours || 24;
      $('social-handle-context').value = item.brandContext || '';
      $('social-handle-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHandleFeedback('Editing ' + item.platform + ' ' + item.handle + '. Save changes below.');
      return;
    }
    if (action === 'kill') {
      if (!window.confirm('KILL AUTOPILOT FOR ' + item.handle + '? This disables future runs and cancels scheduled posts still queued for this handle. A post already accepted by the platform cannot be recalled.')) return;
      button.disabled = true;
      try {
        const result = await api.post('/api/social/handles/' + encodeURIComponent(id) + '/kill', { reason: 'Owner used per-handle KILL button' });
        await refreshHandles();
        setHandleFeedback('KILL SWITCH ACTIVE for ' + item.handle + '. ' + (result.cancelledScheduledPosts || 0) + ' queued post(s) cancelled. Check the platform for any already accepted post.');
        toast('Handle autopilot stopped');
      } catch (error) { setHandleFeedback('Kill request failed: ' + error.message); }
      finally { button.disabled = false; }
      return;
    }
    if (action === 'autonomy') {
      if (item.autoEnabled) {
        try {
          await api.post('/api/social/handles/' + encodeURIComponent(id) + '/autonomy', { enabled: false });
          await refreshHandles();
          setHandleFeedback('Autonomy paused for ' + item.handle + '. Use the KILL button for emergency stop and queue cancellation.');
        } catch (error) { setHandleFeedback('Could not pause autonomy: ' + error.message); }
        return;
      }
      const owner = $('social-handle-owner').value.trim();
      if (!owner) { setHandleFeedback('Enter your name in OWNER CONFIRMATION NAME before enabling unsupervised posting.'); $('social-handle-owner').focus(); return; }
      if (!window.confirm('Enable UNSUPERVISED posting for ' + item.handle + '? XOFT will learn from the configured reader and publish original posts on the configured cadence without per-post approval. The handle has its own KILL button.')) return;
      try {
        await api.post('/api/social/handles/' + encodeURIComponent(id) + '/autonomy', { enabled: true, confirmedBy: owner });
        await refreshHandles();
        setHandleFeedback('Autonomy enabled for ' + item.handle + '. XOFT will begin learning and queue a post when the next run succeeds.');
      } catch (error) { setHandleFeedback('Could not enable autonomy: ' + error.message); }
      return;
    }
    if (action === 'learn' || action === 'run') {
      button.disabled = true;
      setHandleFeedback(action === 'learn' ? 'Reading recent posts and learning the account style…' : 'Running autonomous content cycle…');
      try {
        const result = await api.post('/api/social/handles/' + encodeURIComponent(id) + (action === 'learn' ? '/learn' : '/run'), {});
        await refreshHandles();
        if (action === 'learn') setHandleFeedback('XOFT analyzed ' + result.examplesRead + ' post example(s) for ' + item.handle + '. Review the saved style profile in the handle card.');
        else setHandleFeedback(result.note || 'Autonomous cycle finished. Check the post queue and connector result.');
      } catch (error) { setHandleFeedback((action === 'learn' ? 'Learning failed: ' : 'Autonomous run failed: ') + error.message); await refreshHandles().catch(() => {}); }
      finally { button.disabled = false; }
    }
  });
  const engagementFeedback = (message) => { $('social-engagement-feedback').textContent = message; };
  const renderEngagement = () => {
    const current = $('social-engagement-select').value;
    $('social-engagement-select').innerHTML = '<option value="">Select a comment or DM</option>' + engagementItems.filter((item) => !['replied', 'ignored'].includes(item.status)).map((item) => `<option value="${safe(item.id)}">${safe(item.platform)} · ${safe(item.channel)} · ${safe(item.senderName || 'Unknown sender')} · ${safe(item.status)}</option>`).join('');
    if (engagementItems.some((item) => item.id === current)) $('social-engagement-select').value = current;
    $('social-engagement-list').innerHTML = engagementItems.length ? engagementItems.map((item) => `
      <article class="social-post">
        <div class="social-post-head"><div><strong>${safe(item.senderName || 'Unknown sender')} · ${safe(item.platform)} ${safe(item.channel)}</strong><div class="plugin-results">${safe(localTime(item.receivedAt))} · ${safe(item.status)}</div></div><span class="plugin-category">${safe(item.status)}</span></div>
        <p>${safe(item.message)}</p>
        ${safeHref(item.postUrl) ? `<p><a href="${safeHref(item.postUrl)}" target="_blank" rel="noopener noreferrer">Open original post/conversation</a></p>` : ''}
        ${item.replyDraft ? `<p><strong>Reply draft:</strong> ${safe(item.replyDraft)}</p>` : ''}
        ${item.replySentAt ? `<p class="plugin-safety-note">Connector accepted reply at ${safe(localTime(item.replySentAt))}. This does not prove the recipient read it.</p>` : ''}
        <div class="social-actions"><button type="button" data-engagement-select="${safe(item.id)}">Review / reply</button></div>
      </article>`).join('') : '<div class="empty">No comments or DMs imported yet. Select a connector, discover its tools, and sync the inbox.</div>';
  };
  const refreshEngagement = async () => {
    const [summary, items] = await Promise.all([api.get('/api/social/engagement/summary'), api.get('/api/social/engagement')]);
    engagementItems = items;
    renderEngagement();
    engagementFeedback(`Inbox loaded: ${summary.open} open, ${summary.drafted} drafted, ${summary.replied} replied. Only connected-platform records are included.`);
  };
  $('social-engagement-discover').addEventListener('click', async () => {
    const connectorId = $('social-connector').value;
    if (!connectorId) return engagementFeedback('Choose a configured connector in the Publishing Connection section first.');
    $('social-engagement-discover').disabled = true;
    engagementFeedback('Discovering connector tools…');
    try {
      const discovered = await api.get('/api/connectors/' + encodeURIComponent(connectorId) + '/tools');
      const tools = Array.isArray(discovered?.tools) ? discovered.tools : Array.isArray(discovered?.result?.tools) ? discovered.result.tools : [];
      const names = tools.map((tool) => typeof tool === 'string' ? tool : tool.name).filter(Boolean);
      $('social-tool-options').innerHTML = names.map((name) => '<option value="' + safe(name) + '">').join('');
      const choose = (patterns) => names.find((name) => patterns.some((pattern) => pattern.test(name))) ?? '';
      if (!$('social-comments-tool').value) $('social-comments-tool').value = choose([/comment.*(list|read|fetch|get)/i, /(?:list|read|fetch|get).*comment/i]);
      if (!$('social-dms-tool').value) $('social-dms-tool').value = choose([/direct.*message.*(list|read|fetch|get)/i, /(?:inbox|message|dm).*(list|read|fetch|get)/i, /(?:list|read|fetch|get).*(inbox|message|dm)/i]);
      if (!$('social-reply-tool').value) $('social-reply-tool').value = choose([/(reply|respond).*(comment|message|dm)/i, /(comment|message|dm).*(reply|respond|send)/i]);
      engagementFeedback(names.length ? 'Found ' + names.length + ' connector tool(s). Confirm the selected tools really read the chosen account and send a reply.' : 'No tools returned. Check the connector configuration and discovery response.');
    } catch (error) { engagementFeedback('Tool discovery failed: ' + error.message); }
    finally { $('social-engagement-discover').disabled = false; }
  });
  $('social-engagement-sync').addEventListener('click', async () => {
    const connectorId = $('social-connector').value;
    const commentsTool = $('social-comments-tool').value.trim();
    const dmsTool = $('social-dms-tool').value.trim();
    if (!connectorId) return engagementFeedback('Choose a configured connector first.');
    if (!commentsTool && !dmsTool) return engagementFeedback('Discover and select at least one comments or DM read tool.');
    $('social-engagement-sync').disabled = true;
    engagementFeedback('Syncing authorized comments and messages…');
    try {
      const result = await api.post('/api/social/engagement/sync', { connectorId, commentsTool, dmsTool, platform: $('social-platform-inbox').value });
      await refreshEngagement();
      engagementFeedback(`Sync completed. ${result.count} item(s) imported or refreshed from ${safe(result.platform)}. Review each item before replying.`);
    } catch (error) { engagementFeedback('Inbox sync failed: ' + error.message); }
    finally { $('social-engagement-sync').disabled = false; }
  });
  $('social-engagement-refresh').addEventListener('click', () => refreshEngagement().catch((e) => engagementFeedback('Inbox refresh failed: ' + e.message)));
  $('social-engagement-select').addEventListener('change', () => {
    const item = engagementItems.find((candidate) => candidate.id === $('social-engagement-select').value);
    if (!item) return;
    $('social-reply-content').value = item.replyDraft ?? '';
    engagementFeedback('Selected ' + item.channel + ' from ' + item.platform + '. Generate or edit a reply; nothing is sent until you approve it.');
  });
  $('social-engagement-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-engagement-select]');
    if (!button) return;
    $('social-engagement-select').value = button.dataset.engagementSelect;
    $('social-engagement-select').dispatchEvent(new Event('change'));
    $('social-engagement-select').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('social-reply-generate').addEventListener('click', async () => {
    const id = $('social-engagement-select').value;
    if (!id) return engagementFeedback('Select a comment or DM first.');
    $('social-reply-generate').disabled = true;
    engagementFeedback('XOFT is drafting a reply…');
    try {
      const result = await api.post('/api/social/engagement/' + encodeURIComponent(id) + '/draft', { businessContext: $('social-reply-context').value });
      $('social-reply-content').value = result.item.replyDraft ?? '';
      await refreshEngagement();
      $('social-engagement-select').value = id;
      engagementFeedback('Reply draft prepared. Check facts, tone, and commitments before sending.');
    } catch (error) { engagementFeedback('Reply drafting failed: ' + error.message); }
    finally { $('social-reply-generate').disabled = false; }
  });
  $('social-reply-send').addEventListener('click', async () => {
    const id = $('social-engagement-select').value;
    if (!id) return engagementFeedback('Select an inbox item first.');
    if (!$('social-reply-content').value.trim()) return engagementFeedback('Write or generate the reply first.');
    if (!$('social-reply-approver').value.trim() || !$('social-reply-approval-note').value.trim()) return engagementFeedback('Enter who approves this exact reply and an approval note.');
    if (!$('social-connector').value || !$('social-reply-tool').value.trim()) return engagementFeedback('Choose a configured connector and its reply tool.');
    if (!window.confirm('Send this exact reply to the selected social comment or DM?')) return;
    $('social-reply-send').disabled = true;
    engagementFeedback('Submitting approved reply through connector…');
    try {
      const result = await api.post('/api/social/engagement/' + encodeURIComponent(id) + '/reply', {
        connectorId: $('social-connector').value, replyTool: $('social-reply-tool').value.trim(),
        reply: $('social-reply-content').value, approvedBy: $('social-reply-approver').value.trim(),
        approvalNote: $('social-reply-approval-note').value.trim(),
      });
      await refreshEngagement();
      $('social-engagement-select').value = id;
      engagementFeedback(result.note ?? 'Connector accepted reply request. Check the connected platform to verify visibility.');
      toast('Reply submitted to connector');
    } catch (error) { engagementFeedback('Reply submission failed: ' + error.message + '. Check the connector before retrying to avoid duplicates.'); }
    finally { $('social-reply-send').disabled = false; }
  });
  $('social-engagement-ignore').addEventListener('click', async () => {
    const id = $('social-engagement-select').value;
    if (!id) return engagementFeedback('Select an inbox item first.');
    try {
      await api.post('/api/social/engagement/' + encodeURIComponent(id) + '/ignore', {});
      await refreshEngagement();
      engagementFeedback('Item marked ignored.');
    } catch (error) { engagementFeedback('Could not update inbox item: ' + error.message); }
  });
  refreshEngagement().catch((error) => engagementFeedback('Inbox not available: ' + error.message));
}
