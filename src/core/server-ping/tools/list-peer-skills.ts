// Tool: list-peer-skills
// List all other running skills in the system (demonstrates inter-skill communication).

declare const skills: { list: () => unknown[] };

export const listPeerSkillsTool: ToolDefinition = {
  name: 'list-peer-skills',
  description:
    'List all other running skills in the system (demonstrates inter-skill communication).',
  input_schema: { type: 'object', properties: {} },
  execute(): string {
    try {
      const peers = skills.list();
      return JSON.stringify({ skills: peers });
    } catch (e) {
      return JSON.stringify({ error: String(e), skills: [] });
    }
  },
};
