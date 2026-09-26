import { docsCodeSnippet } from '@/lib/docsCodeSnippet';
import { getAgentPrompt, PRODUCTS } from '@/lib/product-config';

export const AGENT_SKILL_INSTALL = docsCodeSnippet(
  'agent-skill.sh',
  PRODUCTS.trees.skillInstallCommand
);

export const AGENT_PROMPT = docsCodeSnippet(
  'prompt.md',
  getAgentPrompt('trees')
);
