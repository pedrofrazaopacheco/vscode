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
import { ActiveEditorContext } from '../../../../common/contextkeys.js';
import { ChatEditorInput } from '../chatEditorInput.js';
import { Schemas } from '../../../../../base/common/network.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';

export function registerExportActions(): void {
	registerAction2(
		class ExportChatToMarkdownAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.chat.exportToMarkdown',
					title: localize2('chat.exportToMarkdown.label', 'Export Chat to Markdown'),
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
					]
				});
			}
			async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
				const context = args[0];
				const widgetSvc: IChatWidgetService = accessor.get(IChatWidgetService);
				const dialogSvc: IFileDialogService = accessor.get(IFileDialogService);
				const fileSvc: IFileService = accessor.get(IFileService);
				const notificationSvc: INotificationService = accessor.get(INotificationService);

				const widget =
					isChatViewTitleActionContext(context) && context.sessionId
						? widgetSvc.getWidgetBySessionId(context.sessionId)
						: widgetSvc.lastFocusedWidget;

				if (!widget || !widget.viewModel) {
					notificationSvc.error(
						localize2('chat.export.noWidget', 'No chat session available to export').value
					);
					return;
				}

				const viewModel = widget.viewModel;
				const markdown = JSON.stringify(
					viewModel.model.toJSON(),
					null,
					4
				);
				const title: string = viewModel.model.title;

				const defaultName: string = `Github-Copilot-Chat-${title}.md`;

				const targetUri = await dialogSvc.showSaveDialog({
					title: localize2('chat.exportToMarkdown.save.title', 'Export Chat to Markdown').value,
					filters: [{ name: 'Markdown', extensions: ['md'] }],
					defaultUri: URI.from({ scheme: Schemas.file, path: `/${defaultName}` })
				});

				if (!targetUri) {
					return;
				}

				try {
					await fileSvc.writeFile(targetUri, VSBuffer.fromString(markdown));

					notificationSvc.info(
						localize2(
							'chat.export.success',
							'Chat exported successfully to {0}',
							targetUri.fsPath
						).value
					);
				} catch (err: unknown) {
					notificationSvc.error(
						localize2(
							'chat.export.writeError',
							"Couldn't export chat: {0}",
							String(err)
						).value
					);
				}
			}
		}
	);
}
