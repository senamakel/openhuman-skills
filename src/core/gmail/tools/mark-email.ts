// Tool: mark-email
// Mark emails as read/unread, important, starred, etc.
import { gmailFetch } from '../api/index';
import { updateEmailReadStatus } from '../db/helpers';

export const markEmailTool: ToolDefinition = {
  name: 'mark-email',
  description:
    'Mark emails with specific status (read/unread, important, starred) or add/remove labels.',
  input_schema: {
    type: 'object',
    properties: {
      message_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of message IDs to modify',
      },
      action: {
        type: 'string',
        enum: [
          'mark_read',
          'mark_unread',
          'add_star',
          'remove_star',
          'mark_important',
          'mark_not_important',
          'add_labels',
          'remove_labels',
        ],
        description: 'Action to perform on the messages',
      },
      label_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Label IDs to add or remove (required for add_labels/remove_labels actions)',
      },
    },
    required: ['message_ids', 'action'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const messageIds = args.message_ids as string[];
      const action = args.action as string;
      const labelIds = (args.label_ids as string[]) || [];

      if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
        return JSON.stringify({ success: false, error: 'At least one message ID is required' });
      }

      if ((action === 'add_labels' || action === 'remove_labels') && labelIds.length === 0) {
        return JSON.stringify({
          success: false,
          error: 'label_ids are required for add_labels/remove_labels actions',
        });
      }

      // Map actions to label operations
      const labelOperations = getLabelOperations(action, labelIds);

      const results = [];
      const errors = [];

      // Process each message
      for (const messageId of messageIds) {
        try {
          const requestBody = { ids: [messageId], ...labelOperations };

          const response = gmailFetch<{ ids: string[] }>('/users/me/messages/batchModify', {
            method: 'POST',
            body: JSON.stringify(requestBody),
          });

          if (response.success) {
            results.push({ message_id: messageId, success: true, action });

            // Update local database
            if (action === 'mark_read') updateEmailReadStatus(messageId, true);
            else if (action === 'mark_unread') updateEmailReadStatus(messageId, false);
          } else {
            results.push({
              message_id: messageId,
              success: false,
              error: (response.error ? response.error.message : null) || 'Failed to update message',
            });
            errors.push(messageId);
          }
        } catch (error) {
          results.push({
            message_id: messageId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
          errors.push(messageId);
        }
      }

      return JSON.stringify({
        success: errors.length === 0,
        action,
        total_processed: messageIds.length,
        successful: results.filter(r => r.success).length,
        failed: errors.length,
        results,
        failed_message_ids: errors,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

/**
 * Helper: Convert action to Gmail API label operations
 */
function getLabelOperations(action: string, labelIds: string[] = []) {
  const operations: { addLabelIds?: string[]; removeLabelIds?: string[] } = {};

  switch (action) {
    case 'mark_read':
      operations.removeLabelIds = ['UNREAD'];
      break;

    case 'mark_unread':
      operations.addLabelIds = ['UNREAD'];
      break;

    case 'add_star':
      operations.addLabelIds = ['STARRED'];
      break;

    case 'remove_star':
      operations.removeLabelIds = ['STARRED'];
      break;

    case 'mark_important':
      operations.addLabelIds = ['IMPORTANT'];
      break;

    case 'mark_not_important':
      operations.removeLabelIds = ['IMPORTANT'];
      break;

    case 'add_labels':
      operations.addLabelIds = labelIds;
      break;

    case 'remove_labels':
      operations.removeLabelIds = labelIds;
      break;

    default:
      throw new Error(`Unknown action: ${action}`);
  }

  return operations;
}
