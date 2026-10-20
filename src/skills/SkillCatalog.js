const SKILLS = [
  {
    id: 'opportunity_research',
    name: 'Opportunity Research',
    purpose: 'Find and organise public opportunities that may fit configured services.',
    available: true,
    workflow: ['Search configured public sources', 'Deduplicate by source and title/company', 'Record evidence and source URL', 'Score fit and flag risks', 'Set a review/follow-up action'],
    tools: ['search_web', 'OpportunityStore', 'OpportunityScout'],
    completionEvidence: ['source URL', 'search evidence', 'saved opportunity record'],
    limits: ['Search results are leads, not verified clients or guaranteed income.', 'No unsolicited outreach or job acceptance is implied.'],
  },
  {
    id: 'web_app_delivery',
    name: 'Web Application Delivery',
    purpose: 'Build a requested application inside an explicitly assigned project workspace.',
    available: true,
    workflow: ['Read PROJECT_BRIEF.md and inspect existing files', 'Clarify missing acceptance criteria in the task report', 'Plan small verifiable changes', 'Implement responsive accessible UI and required backend behavior', 'Run project-appropriate tests/builds', 'Fix failures and rerun relevant checks', 'Document run/deploy instructions and known limitations'],
    tools: ['engine_run_task', 'engine_task_status', 'TaskPlanner', 'GitWorkspace'],
    completionEvidence: ['changed files', 'exact commands run', 'exit codes', 'test/build output', 'artifact paths'],
    limits: ['Actual execution depends on an available engine, configured permissions, and a reachable workspace.', 'Do not report a deployment unless a hosting provider confirms it.'],
  },
  {
    id: 'code_quality_and_testing',
    name: 'Code Quality and Testing',
    purpose: 'Verify implementation rather than infer success from generated code.',
    available: true,
    workflow: ['Inspect package scripts and test setup', 'Run relevant syntax/type/test/build checks', 'Capture failing output', 'Fix only supported issues', 'Rerun affected checks', 'Report checks that could not be run'],
    tools: ['engine_run_task', 'engine_task_status', 'SelfDevelopmentEngine.sandboxTest'],
    completionEvidence: ['command', 'exit code', 'test summary', 'remaining failures'],
    limits: ['A syntax check is not a passing test suite; unavailable dependencies/network must be reported.'],
  },
  {
    id: 'deployment_readiness',
    name: 'Deployment Readiness',
    purpose: 'Prepare and verify deployment configuration without exposing secrets.',
    available: true,
    workflow: ['Identify runtime/start command', 'Check health/readiness routes', 'Check required environment variable names', 'Check persistent storage and migration needs', 'Run build/test gates', 'Request explicit approval before production deployment', 'Record provider URL and deployment ID only after confirmation'],
    tools: ['SelfDevelopmentEngine', 'DeploymentManager', 'systemWatchdog'],
    completionEvidence: ['build/test results', 'environment-variable checklist without values', 'provider deployment ID/status', 'health-check result'],
    limits: ['Self-development canary is not the same as deploying to Vercel/Railway.', 'Cloud deployment requires a configured provider and explicit production authorization.'],
  },
  {
    id: 'client_project_lifecycle',
    name: 'Client Project Lifecycle',
    purpose: 'Track a client project from proposal draft through acceptance, delivery, invoicing, and evidence-backed payment status.',
    available: true,
    workflow: ['Prepare proposal draft', 'Record written client acceptance', 'Create linked delivery mission', 'Build and verify in project workspace', 'Move completed mission to quality review', 'Record delivery evidence', 'Create invoice draft', 'Record invoice-sending reference', 'Record payment reference before marking paid'],
    tools: ['ProjectDeliveryManager', 'MissionManager', 'MissionAutopilot'],
    completionEvidence: ['acceptance reference', 'mission result', 'delivery artifact/URL', 'invoice reference', 'payment reference'],
    limits: ['This skill does not move funds, invent acceptance, or send invoices without an integrated provider.'],
  },
  {
    id: 'client_communications',
    name: 'Client Communications',
    purpose: 'Prepare and, when explicitly approved and consent is recorded, send eligible follow-ups.',
    available: true,
    workflow: ['Prepare a message draft', 'Verify saved recipient/channel', 'Record approver and opt-in evidence', 'Send through configured provider', 'Store provider message ID', 'Wait for provider delivery/read status before claiming delivery'],
    tools: ['OpportunityFollowUpPlanner', 'WhatsAppService'],
    completionEvidence: ['draft ID', 'approver', 'opt-in evidence', 'provider message ID', 'webhook delivery status if available'],
    limits: ['Plain text WhatsApp messages can be restricted by the customer-service window; templates may be required.', 'Provider acceptance is not proof of delivery/read.'],
  },
];

export function listSkills() {
  return SKILLS.map((skill) => ({
    ...skill,
    workflow: [...skill.workflow],
    tools: [...skill.tools],
    completionEvidence: [...skill.completionEvidence],
    limits: [...skill.limits],
  }));
}

export function getSkill(id) {
  const skill = SKILLS.find((item) => item.id === id);
  return skill ? listSkills().find((item) => item.id === id) : null;
}

export function buildDeliverySkillBrief(project) {
  const skill = getSkill('web_app_delivery');
  return [
    'EXECUTION SKILL: ' + skill.name,
    skill.purpose,
    'Workspace: ' + project.workspacePath,
    'Read PROJECT_BRIEF.md first. Work only inside this assigned workspace unless the owner explicitly authorizes another path.',
    'Required workflow:',
    ...skill.workflow.map((step, index) => (index + 1) + '. ' + step),
    'Required completion report:',
    ...skill.completionEvidence.map((item) => '- ' + item),
    'Guardrails:',
    ...skill.limits.map((item) => '- ' + item),
    'Do not claim completion if the actual task status or verification evidence does not support it.',
  ].join('\n');
}
