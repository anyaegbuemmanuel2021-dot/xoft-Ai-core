import { Tool, RiskLevel } from '../Tool.js';

export function buildSocialTools({ socialMediaScheduler } = {}) {
  if (!socialMediaScheduler) return [];
  return [
    new Tool({
      name: 'social_list_posts',
      description: 'List XOFT social media drafts, scheduled posts, published posts, and failed posts. Use before reporting the social calendar status.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'] },
          platform: { type: 'string', enum: ['facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'youtube', 'threads', 'other'] },
          limit: { type: 'number' },
        },
      },
      riskLevel: RiskLevel.SAFE,
      status: 'IMPLEMENTED',
      execute: async ({ status, platform, limit }) => ({ posts: socialMediaScheduler.list({ status, platform, limit }), summary: socialMediaScheduler.summary() }),
    }),
    new Tool({
      name: 'social_create_draft',
      description: 'Save a social media post as a draft for the boss to review. This never publishes or schedules the post.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 180 },
          content: { type: 'string', maxLength: 10000 },
          platforms: { type: 'array', items: { type: 'string', enum: ['facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'youtube', 'threads', 'other'] }, minItems: 1 },
          hashtags: { type: 'array', items: { type: 'string' } },
          mediaUrls: { type: 'array', items: { type: 'string' } },
        },
        required: ['content', 'platforms'],
      },
      riskLevel: RiskLevel.LOW,
      status: 'IMPLEMENTED',
      execute: async (input) => {
        const post = socialMediaScheduler.create(input);
        return { post, note: 'Saved as draft only. No external post was published or scheduled.' };
      },
    }),
  ];
}
