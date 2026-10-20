import { Tool, RiskLevel } from '../Tool.js';

export function buildSocialEngagementTools({ socialEngagementManager } = {}) {
  if (!socialEngagementManager) return [];
  return [
    new Tool({
      name: 'social_inbox_list',
      description: 'Review imported social media comments and direct messages. Use this before summarizing inbox activity or choosing which message needs a reply. Only connector-synced items are visible.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'drafted', 'replied', 'ignored'] },
          channel: { type: 'string', enum: ['comment', 'dm'] },
          platform: { type: 'string', maxLength: 40 },
          limit: { type: 'number' },
        },
      },
      riskLevel: RiskLevel.SAFE,
      status: 'IMPLEMENTED',
      execute: async ({ status, channel, platform, limit }) => ({ items: socialEngagementManager.list({ status, channel, platform, limit }), summary: socialEngagementManager.summary() }),
    }),
    new Tool({
      name: 'social_save_reply_draft',
      description: 'Save a proposed reply to an imported social comment or DM. This does not send anything; a named user must approve sending through the Social Studio inbox.',
      inputSchema: {
        type: 'object',
        properties: { engagementId: { type: 'string' }, reply: { type: 'string', maxLength: 5000 } },
        required: ['engagementId', 'reply'],
      },
      riskLevel: RiskLevel.LOW,
      status: 'IMPLEMENTED',
      execute: async ({ engagementId, reply }) => {
        const item = socialEngagementManager.saveDraft(engagementId, reply);
        if (!item) throw new Error('Social engagement not found');
        return { item, sent: false, note: 'Reply draft saved. It has not been sent.' };
      },
    }),
  ];
}
