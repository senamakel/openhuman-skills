// Tool: read-config
// Read the current skill configuration from the data directory (demonstrates data file I/O).

declare const data: { read: (path: string) => string | null };

export const readConfigTool: ToolDefinition = {
  name: 'read-config',
  description:
    'Read the current skill configuration from the data directory (demonstrates data file I/O).',
  input_schema: { type: 'object', properties: {} },
  execute(): string {
    try {
      const raw = data.read('config.json');
      return raw || JSON.stringify({ error: 'No config file found' });
    } catch (e) {
      return JSON.stringify({ error: `Failed to read config: ${e}` });
    }
  },
};
