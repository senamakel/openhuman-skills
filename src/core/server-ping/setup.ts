// Setup wizard for server-ping skill
import type { ServerPingState } from './state';

declare global {
  var serverPingSetup: {
    onSetupStart: () => Promise<SetupStartResult>;
    onSetupSubmit: (args: {
      stepId: string;
      values: Record<string, unknown>;
    }) => Promise<SetupSubmitResult>;
    onSetupCancel: () => Promise<void>;
  };
}

async function onSetupStart(): Promise<SetupStartResult> {
  console.log('[server-ping] onSetupStart');
  const defaultUrl = platform.env('BACKEND_URL') || platform.env('BACKEND_URL') || '';

  return {
    step: {
      id: 'server-config',
      title: 'Server Configuration',
      description: 'Enter the server URL to monitor and choose a ping interval.',
      fields: [
        {
          name: 'serverUrl',
          type: 'text',
          label: 'Server URL',
          description: 'Full URL to ping (e.g. https://api.example.com/health)',
          required: true,
          default: defaultUrl,
          placeholder: 'https://api.example.com/health',
        },
        {
          name: 'pingIntervalSec',
          type: 'select',
          label: 'Ping Interval',
          description: 'How often to check the server',
          required: true,
          default: '10',
          options: [
            { label: 'Every 5 seconds', value: '5' },
            { label: 'Every 10 seconds', value: '10' },
            { label: 'Every 30 seconds', value: '30' },
            { label: 'Every 60 seconds', value: '60' },
          ],
        },
      ],
    },
  };
}

async function onSetupSubmit(args: {
  stepId: string;
  values: Record<string, unknown>;
}): Promise<SetupSubmitResult> {
  const { stepId, values } = args;
  const s = (globalThis as any).getSkillState() as ServerPingState;

  if (stepId === 'server-config') {
    const url = ((values.serverUrl as string) || '').trim();
    if (!url) {
      return {
        status: 'error',
        errors: [{ field: 'serverUrl', message: 'Server URL is required' }],
      };
    }
    if (!url.startsWith('http')) {
      return {
        status: 'error',
        errors: [{ field: 'serverUrl', message: 'URL must start with http:// or https://' }],
      };
    }

    // Verify the server is reachable before proceeding
    try {
      const response = await net.fetch(url, { method: 'GET', timeout: 10000 });
      if (response.status >= 500) {
        return {
          status: 'error',
          errors: [
            {
              field: 'serverUrl',
              message: `Server returned error ${response.status}. Verify the URL is correct.`,
            },
          ],
        };
      }
      // Any 1xx–4xx means the server is reachable (even 404 = server is there)
    } catch (e) {
      return {
        status: 'error',
        errors: [
          {
            field: 'serverUrl',
            message: `Could not reach server: ${String(e)}. Check the URL and try again.`,
          },
        ],
      };
    }

    s.config.serverUrl = url;
    s.config.pingIntervalSec = parseInt(values.pingIntervalSec as string) || 10;

    return {
      status: 'next',
      nextStep: {
        id: 'notification-config',
        title: 'Notification Preferences',
        description: 'Choose when to receive desktop notifications.',
        fields: [
          {
            name: 'notifyOnDown',
            type: 'boolean',
            label: 'Notify when server goes down',
            description: 'Send a desktop notification when the server becomes unreachable',
            required: false,
            default: true,
          },
          {
            name: 'notifyOnRecover',
            type: 'boolean',
            label: 'Notify when server recovers',
            description: 'Send a desktop notification when the server comes back online',
            required: false,
            default: true,
          },
        ],
      },
    };
  }

  if (stepId === 'notification-config') {
    s.config.notifyOnDown = values.notifyOnDown != null ? (values.notifyOnDown as boolean) : true;
    s.config.notifyOnRecover =
      values.notifyOnRecover != null ? (values.notifyOnRecover as boolean) : true;

    state.set('config', s.config);
    data.write('config.json', JSON.stringify(s.config, null, 2));

    console.log(`[server-ping] Setup complete — monitoring ${s.config.serverUrl}`);
    return { status: 'complete' };
  }

  return { status: 'error', errors: [{ field: '', message: `Unknown setup step: ${stepId}` }] };
}

async function onSetupCancel(): Promise<void> {
  console.log('[server-ping] Setup cancelled');
}

globalThis.serverPingSetup = { onSetupStart, onSetupSubmit, onSetupCancel };

export { onSetupStart, onSetupSubmit, onSetupCancel };
