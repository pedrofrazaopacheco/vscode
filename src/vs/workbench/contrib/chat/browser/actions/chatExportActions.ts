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
import { basename } from '../../../../../base/common/resources.js';
import { Schemas } from '../../../../../base/common/network.js';
import { IChatRequestVariableEntry } from '../../common/chatModel.js';

export function registerExportActions() {
	registerAction2(class ExportChatToMarkdownAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.chat.exportToMarkdown',
				title: localize2('chat.exportToMarkdown.label', "Export Chat to Markdown"),
				category: CHAT_CATEGORY,
				icon: Codicon.cloudDownload,
				precondition: ChatContextKeys.enabled,
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

			// Build a nicer default filename: "<title>-YYYY-MM-DD-HHmm.md"
			const date = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
			const safeTitle = widget.viewModel.sessionId.replace(/[^\w\-]+/g, '_');
			const defaultFileName = `${safeTitle || 'chat'}-${date}.md`;

			// Ask user where to save the file
			const uri = await fileDialogService.showSaveDialog({
				title: localize2('chat.exportToMarkdown.save.title', "Export Chat to Markdown").value,
				filters: [{ name: 'Markdown', extensions: ['md'] }],
				defaultUri: URI.parse(`file:///${defaultFileName}`)
			});

			if (!uri) {
				return; // User cancelled
			}

			// Save the file
			await fileService.writeFile(uri, VSBuffer.fromString(markdownContent));
		}
	});
}

/**
 * Human-readable bullet for any IChatRequestVariableEntry.
 */
function stringifyVariableEntry(v: IChatRequestVariableEntry): string {
	const base = `- **${v.name}**`;
	switch (v.kind) {
		case 'file':
		case 'promptFile':
			// allow-any-unicode-next-line
			return `${base}  \n  ↳ ${basename(URI.isUri(v.value) ? v.value : URI.parse(String(v.value)))}`;
		case 'directory':
			// allow-any-unicode-next-line
			return `${base}  \n  ↳ ${URI.isUri(v.value) ? v.value.fsPath : String(v.value)}`;
		case 'paste':
			return `${base} *(pasted ${v.language}, ${v.pastedLines})*`;
		case 'image':
			return `${base} *(image, mime ${v.mimeType ?? 'unknown'})*`;
		case 'diagnostic':
			return `${base} *(diagnostic)*`;
		case 'tool':
		case 'toolset':
			return `${base} *(tool)*`;
		case 'notebookOutput':
			return `${base} *(notebook output)*`;
		case 'implicit':
			return `${base} *(implicit ${v.isSelection ? 'selection' : 'file'})*`;
		case 'scmHistoryItem':
			return `${base} *(SCM history)*`;
		default:
			return `${base}: ${String(v.value)}`;
	}
}

/**
 * Human-readable representation of any IChatProgressResponseContent.
 */
function stringifyResponsePart(part: any): string {
	switch (part.kind) {
		case 'markdownContent':
		case 'markdownVuln':
			return part.content?.value ?? '';
		case 'inlineReference':
			if ('uri' in part.inlineReference) {
				return part.inlineReference.uri.toString();
			}
			return '`' + (part.inlineReference.name ?? '') + '`';
		case 'treeData':
			return '```json\n' + JSON.stringify(part.treeData, null, 2) + '\n```';
		case 'progressMessage':
			return `> ${part.content}`;
		case 'codeblockUri':
			return `\n\`\`\`\n${part.uri.toString()}\n\`\`\``;
		case 'textEditGroup':
		case 'notebookEditGroup':
			return localize2('chat.export.textEdits', "*Applied code edits*").value;
		case 'command':
			return `**Command**: ${part.command.title}`;
		case 'toolInvocation':
			return `**Tool**: ${part.toolId ?? localize2('chat.export.unknownTool', "Unknown Tool").value}`;
		case 'confirmation':
			return `**⚠ Confirmation Required**: ${part.title}\n${part.message}`;
		case 'extensions':
			return localize2('chat.export.extensions', "*Extension content omitted*").value;
		case 'undoStop':
		case 'prepareToolInvocation':
			return ''; // not user-visible
		default:
			return '';
	}
}

function generateMarkdownFromChat(viewModel: IChatViewModel): string {
	const md: string[] = [];

	// Header & metadata
	md.push(`# ${localize2('chat.export.header', "Chat Export")}`);
	md.push(`**Exported:** ${new Date().toLocaleString()}`);
	md.push(`**Session ID:** ${viewModel.sessionId}`);
	md.push('');

	// Walk through every item
	for (const item of viewModel.getItems()) {
		if (isRequestVM(item)) {
			md.push('---');
			// allow-any-unicode-next-line
			md.push(`## 🙋 ${localize2('chat.export.userRequest', "User Request")}`);
			md.push(`**Username:** ${item.username}`);
			if (item.agentOrSlashCommandDetected && item.slashCommand) {
				md.push(`**Command:** /${item.slashCommand.name}`);
			}

			if (item.variables?.length) {
				md.push(`**Variables:**`);
				for (const v of item.variables) {
					md.push(stringifyVariableEntry(v));
				}
			}

			if (item.contentReferences?.length) {
				md.push(`**Referenced Content:**`);
				for (const ref of item.contentReferences) {
					md.push(`- ${ref.reference?.toString()}`);
				}
			}

			if (item.confirmation) {
				md.push(`**Confirmation:** ${item.confirmation}`);
			}

			md.push(`**Message:**\n${item.messageText}`);
			if (item.attempt > 0) {
				md.push(`*(Attempt ${item.attempt + 1})*`);
			}
			md.push('');

		} else if (isResponseVM(item)) {
			// allow-any-unicode-next-line
			md.push(`## 🤖 ${localize2('chat.export.assistantResponse', "Assistant Response")}`);
			if (item.agent) {
				md.push(`**Agent:** ${item.username}`);
			}
			if (item.slashCommand) {
				md.push(`**Command:** /${item.slashCommand.name}`);
			}

			if (item.usedContext) {
				md.push(`**Used Context:**`);
				for (const d of item.usedContext.documents) {
					const ranges = (d.ranges ?? []).map(r => `lines ${r.startLineNumber}-${r.endLineNumber}`).join(', ');
					md.push(`- ${d.uri.toString()}${ranges ? ` (${ranges})` : ''}`);
				}
			}

			if (item.contentReferences?.length) {
				md.push(`**Content References:**`);
				for (const ref of item.contentReferences) {
					md.push(`- ${ref.reference?.toString()}`);
				}
			}

			if (item.codeCitations?.length) {
				md.push(`**Code Citations:**`);
				for (const cit of item.codeCitations) {
					md.push(`- ${cit.value} (${cit.license})`);
				}
			}

			if (item.progressMessages?.length) {
				md.push(`**Progress Messages:**`);
				for (const p of item.progressMessages) {
					md.push(`- ${p.content}`);
				}
			}

			// Full streamed response
			md.push(`**Response:**`);
			for (const part of item.response.value) {
				const partStr = stringifyResponsePart(part);
				if (partStr) {
					md.push(partStr);
				}
			}

			if (item.vote !== undefined) {
				// allow-any-unicode-next-line
				const voteStr = item.vote === 1 ? '👍' : '👎';
				md.push(`**Vote:** ${voteStr}${item.voteDownReason ? ` (${item.voteDownReason})` : ''}`);
			}

			if (item.errorDetails) {
				md.push(`**Error:** ${item.errorDetails.message}`);
				if (item.errorDetails.responseIsFiltered) {
					md.push(`*Response was filtered*`);
				}
			}

			if (item.replyFollowups?.length) {
				md.push(`**Suggested Follow-ups:**`);
				for (const f of item.replyFollowups) {
					md.push(`- ${f.message}`);
				}
			}

			if (!item.isComplete) {
				md.push(`*Response incomplete*`);
			}
			if (item.isCanceled) {
				md.push(`*Response was canceled*`);
			}
			if (item.isPaused?.get?.()) {
				md.push(`*Response is paused*`);
			}
			md.push('');
		}
	}

	// Final horizontal rule
	md.push('---');
	return md.join('\n');
}
