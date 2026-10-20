import { api } from '../api.js';
import { esc, toast } from '../dom.js';

export const title = 'Social Studio';

const PLATFORMS = [
  ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'],
  ['x', 'X'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['threads', 'Threads'], ['other', 'Other'],
];
const localTime = (value) => value ? new Date(value).toLocaleString() : 'Not set';
const safe = (value) => esc(String(value ?? ''));

function platformChecks(selected = ['facebook', 'instagram', 'linkedin']) {
  return PLATFORMS.map(([id, label]) => `<label class="social-platform"><input type="checkbox" name="social-platform" value="${id}" ${selected.includes(id) ? 'checked' : ''}><span>${label}</span></label>`).join('');
}

export async function render(container) {
  let summary = { total: 0, drafts: 0, scheduled: 0, published: 0, failed: 0, connectors: [] };
  let posts = [];
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
    <section class="card">
      <div class="plugin-section-head"><div><span class="plugin-kicker">CONTENT WORKBENCH</span><h2>Create a post</h2></div><span class="plugin-category">Draft first · approve before publishing</span></div>
      <div class="plugin-form-grid">
        <div class="form-row"><label for="social-brief">WHAT SHOULD XOFT TALK ABOUT?</label><input id="social-brief" maxlength="1200" placeholder="e.g. Promote Softly Digitals' website and chatbot services" /></div>
        <div class="form-row"><label for="social-goal">POST GOAL</label><select id="social-goal"><option value="engagement">Build engagement</option><option value="leads">Generate qualified leads</option><option value="educate">Educate the audience</option><option value="announce">Make an announcement</option><option value="promote">Promote a service</option></select></div>
        <div class="form-row"><label for="social-tone">BRAND VOICE</label><select id="social-tone"><option>Professional and clear</option><option>Friendly and conversational</option><option>Bold and persuasive</option><option>Educational and practical</option><option>Premium and minimal</option></select></div>
        <div class="form-row"><label for="social-cta">CALL TO ACTION (OPTIONAL)</label><input id="social-cta" maxlength="240" placeholder="e.g. Send us a message for a quote" /></div>
      </div>
      <div class="form-row"><label>PLATFORMS</label><div class="social-platforms">${platformChecks()}</div></div>
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
  `;

  const $ = (id) => container.querySelector('#' + id);
  const selectedPlatforms = () => [...container.querySelectorAll('input[name="social-platform"]:checked')].map((el) => el.value);
  const setFeedback = (message) => { $('social-feedback').textContent = message; };
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
        <div class="social-post-head"><div><strong>${safe(p.title)}</strong><div class="plugin-results">${safe(p.platforms.join(', '))} · ${safe(localTime(p.scheduledAt))}</div></div><span class="plugin-category">${safe(p.status)}</span></div>
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
  $('social-save').addEventListener('click', async () => {
    try {
      const content = $('social-content').value.trim();
      if (!content) return setFeedback('Write or generate the post copy first.');
      const hashtags = $('social-hashtags').value.split(',').map((x) => x.trim()).filter(Boolean);
      const payload = { title: $('social-brief').value.trim(), content, platforms: selectedPlatforms(), hashtags };
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
}
