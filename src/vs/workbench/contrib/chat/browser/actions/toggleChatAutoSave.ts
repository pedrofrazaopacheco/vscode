/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Toggle Copilot-Chat auto-save
 *--------------------------------------------------------------------------------------------*/

/* helpers (caminhos relativos em .js) ------------------------------------------------------- */
import * as nls from '../../../../../nls.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';

/* platform ------------------------------------------------------------------------------- */
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';

/* chat ------------------------------------------------------------------------------------ */
import { IChatService } from '../../common/chatService.js';
import { ChatViewId } from '../chat.js';   // acrescenta para usar o id
import { ChatContextKeys } from '../../common/chatContextKeys.js';

/* Chaves de storage (por workspace) ------------------------------------------------------- */
const STORAGE_ENABLED = 'chat.autoSave.enabled';
const STORAGE_FILE_URI = 'chat.autoSave.fileUri';

/** Append `markdown` ao ficheiro - le primeiro (se existir) e sobrescreve.  */
async function appendMarkdown(fileSvc: IFileService, uri: URI, markdown: string): Promise<void> {
	let existing = '';
	try {
		existing = (await fileSvc.readFile(uri)).value.toString();
	} catch { /* ficheiro ainda nao existe */ }

	await fileSvc.writeFile(uri, VSBuffer.fromString(existing + markdown));
}

class ToggleChatAutoSaveAction extends Action2 {

	constructor() {
		super({
			id: 'chat.toggleAutoSave',
			title: { value: nls.localize('chat.autoSave', "Auto-save Chat Transcript"), original: 'Auto-save Chat Transcript' },
			icon: Codicon.save,
			f1: false,
			precondition: ContextKeyExpr.and(ChatContextKeys.chatMode, ContextKeyExpr.not(ChatContextKeys.requestInProgress.key)),
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', ChatViewId),
				group: 'navigation',
				order: -4
			},
		});
	}

	run = async (accessor: ServicesAccessor): Promise<void> => {

		const quick = accessor.get(IQuickInputService);
		const dialogs = accessor.get(IFileDialogService);
		const storage = accessor.get(IStorageService);
		const files = accessor.get(IFileService);
		const chat = accessor.get(IChatService);

		/*  estado actual  */
		const enabled = storage.getBoolean(STORAGE_ENABLED, StorageScope.WORKSPACE, false);
		let fileUri = storage.get(STORAGE_FILE_URI, StorageScope.WORKSPACE)
			? URI.parse(storage.get(STORAGE_FILE_URI, StorageScope.WORKSPACE)!)
			: undefined;

		/*  activar  */
		if (!enabled) {

			// escolher ficheiro na 1 vez ou se utilizador preferir criar novo
			if (!fileUri) {
				fileUri = await dialogs.showSaveDialog({
					title: nls.localize('chat.saveTransTitle', "Choose file for chat transcript"),
					saveLabel: nls.localize('chat.saveTrans', "Save transcript"),
					defaultUri: URI.file('copilot-chat.md')
				});
				if (!fileUri) { return; }     // cancelado
			} else {
				const choice = await quick.pick(
					[
						{ id: 'same', label: '$(save) ' + nls.localize('chat.useSame', "Continue in existing file") },
						{ id: 'new', label: '$(new-file) ' + nls.localize('chat.newFile', "Create new file") }
					],
					{ canPickMany: false, title: nls.localize('chat.autoSave', "Auto-save Chat Transcript") }
				);
				if (!choice) { return; }
				if (choice.id === 'new') {
					const fresh = await dialogs.showSaveDialog({
						saveLabel: nls.localize('chat.saveTrans', "Save transcript"),
						defaultUri: fileUri
					});
					if (!fresh) { return; }
					fileUri = fresh;
				}
			}

			// persistir escolhas
			await storage.store(STORAGE_FILE_URI, fileUri.toString(), StorageScope.WORKSPACE, StorageTarget.USER);
			await storage.store(STORAGE_ENABLED, true, StorageScope.WORKSPACE, StorageTarget.USER);

			/* listener de respostas ------------------------------------------------------- */
			const disposable = (chat as any).onDidAddResponse?.(async (e: any) => {
				if (!fileUri) { return; }
				const stamp = new Date().toISOString();
				const block = `### ${stamp}\n\n**Q:** ${e.message}\n\n**A:** ${e.response}\n\n---\n`;
				await appendMarkdown(files, fileUri, block);
			});

			if (disposable) {
				// Action2 tem o campo _store para limpar disposables
				(this as any)._store?.add(disposable);
			}

			/*  desactivar  */
		} else {
			await storage.store(STORAGE_ENABLED, false, StorageScope.WORKSPACE, StorageTarget.USER);
		}
	};
}

registerAction2(ToggleChatAutoSaveAction);
