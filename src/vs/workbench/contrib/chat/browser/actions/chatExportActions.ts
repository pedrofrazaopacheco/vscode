/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { isChatViewTitleActionContext } from '../../common/chatActions.js';
import { ChatContextKeys } from '../../common/chatContextKeys.js';
import { ChatViewId, IChatWidgetService } from '../chat.js';
import { CHAT_CATEGORY } from './chatActions.js';
import { IChatViewModel, isRequestVM, isResponseVM } from '../../common/chatViewModel.js';
import { ActiveEditorContext } from '../../../../common/contextkeys.js';
import { ChatEditorInput } from '../chatEditorInput.js';

export function registerExportActions() {
	registerAction2(class ExportChatToMarkdownAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.chat.exportToMarkdown',
				title: localize2('chat.exportToMarkdown.label', "Export Chat to Markdown"),
				category: CHAT_CATEGORY,
				icon: Codicon.cloudDownload,
				precondition: ContextKeyExpr.and(ChatContextKeys.chatMode, ContextKeyExpr.not(ChatContextKeys.requestInProgress.key)),
				f1: true,
				menu: [
					{
						id: MenuId.ViewTitle,
						when: ContextKeyExpr.equals('view', ChatViewId),
						group: '1_export',
						order: 1
					},
					{
						id: MenuId.EditorTitle,
						when: ActiveEditorContext.isEqualTo(ChatEditorInput.EditorID),
						group: 'navigation',
						order: 10
					}
				],
			});
		}

		async run(accessor: ServicesAccessor, ...args: any[]) {
			const context = args[0];
			const widgetService = accessor.get(IChatWidgetService);
			const fileDialogService = accessor.get(IFileDialogService);
			const fileService = accessor.get(IFileService);

			// Get the current widget, either from context or last focused
			const widget = (isChatViewTitleActionContext(context) && context.sessionId)
				? widgetService.getWidgetBySessionId(context.sessionId)
				: widgetService.lastFocusedWidget;

			if (!widget || !widget.viewModel) {
				return;
			}

			// Generate markdown content from the conversation
			const markdownContent = generateMarkdownFromChat(widget.viewModel);

			// Ask user where to save the file
			const uri = await fileDialogService.showSaveDialog({
				title: localize2('chat.exportToMarkdown.save.title', "Export Chat to Markdown").value,
				filters: [{ name: 'Markdown', extensions: ['md'] }],
				defaultUri: URI.parse('file:///chat-export.md')
			});

			if (!uri) {
				return; // User cancelled
			}

			// Save the file
			await fileService.writeFile(uri, VSBuffer.fromString(markdownContent));
		}
	});
}

function generateMarkdownFromChat(viewModel: IChatViewModel): string {
	let markdown = `# Chat Export - ${new Date().toLocaleString()}\n\n`;

	// Add requests and responses
	for (const item of viewModel.getItems()) {
		// Add the user's request
		let markdownRequest = '';
		if (isRequestVM(item)) {
			// This is a user message (IChatRequestViewModel)
			const userMessage = item.messageText;
			markdownRequest += `## User\n\n`;
			markdownRequest += `${userMessage}\n\n`;
		} else if (isResponseVM(item)) {
			// This is an AI response (IChatResponseViewModel)
			markdownRequest += `## Assistant Response\n\n`;
			const aiResponse = item.response.value;
			markdownRequest += aiResponse.map(part => {
				if (part.kind === 'markdownContent' && part.content?.value) {
					return part.content.value;
				}
				return '';
			}).join('');
		}
		markdown += markdownRequest;
	}
	return markdown;
}
