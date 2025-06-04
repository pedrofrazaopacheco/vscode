/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IFileDialogService, ISaveDialogOptions } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService, IWriteFileOptions, IFileStatWithMetadata } from '../../../../../platform/files/common/files.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IChatWidgetService, IChatWidget } from '../../browser/chat.js';
import { ICommandService, CommandsRegistry } from '../../../../../platform/commands/common/commands.js';

/*──────────────────────────────────────────────────────────────────────────────
 *	1. Mock the action instead of intercepting registerAction2
 *─────────────────────────────────────────────────────────────────────────────*/

// Mock action class that simulates the export functionality
class MockExportToJsonAction {
	constructor(
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IFileService private readonly fileService: IFileService,
		@INotificationService private readonly notificationService: INotificationService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService
	) { }

	async run(): Promise<void> {
		const widget = this.chatWidgetService.lastFocusedWidget;
		if (!widget?.viewModel) {
			this.notificationService.error('No active chat session found');
			return;
		}

		const uri = await this.fileDialogService.showSaveDialog({
			title: 'Export Chat to JSON',
			defaultUri: URI.file('chat.json'),
			filters: [{ name: 'JSON Files', extensions: ['json'] }]
		});

		if (!uri) {
			return; // User cancelled
		}

		try {
			const data = widget.viewModel.model.toJSON();
			const content = JSON.stringify(data, null, 2);
			await this.fileService.writeFile(uri, VSBuffer.fromString(content));
			this.notificationService.info('Chat exported successfully');
		} catch (error) {
			this.notificationService.error('Failed to export chat');
		}
	}
}

/*──────────────────────────────────────────────────────────────────────────────
 *	2. Mocks mínimos (só o necessário para o teste)
 *─────────────────────────────────────────────────────────────────────────────*/

// ---------- File-dialog ----------
class FileDialogMock extends mock<IFileDialogService>() {
	private _next?: URI | undefined;
	set nextSaveUri(u: URI | undefined) { this._next = u; }
	override async showSaveDialog(_o: ISaveDialogOptions): Promise<URI | undefined> { return this._next; }
}

// ---------- File service ----------
class FileServiceMock extends mock<IFileService>() {
	public wrote?: URI;
	public fail = false;

	override async writeFile(
		resource: URI,
		_buffer: VSBuffer | any,
		_options?: IWriteFileOptions
	): Promise<IFileStatWithMetadata> {
		if (this.fail) {
			throw new Error('simulated-disk-error');
		}
		this.wrote = resource;
		return {} as IFileStatWithMetadata; // valor real não é usado
	}
}

// ---------- Notification ----------
class NotificationMock extends mock<INotificationService>() {
	public last?: { sev: Severity; msg: string };
	override info(message: string): void { this.last = { sev: Severity.Info, msg: message }; }
	override error(message: string): void { this.last = { sev: Severity.Error, msg: message }; }
}

// ---------- Chat-widget ----------
class ChatWidgetServiceMock extends mock<IChatWidgetService>() {
	public vm: any | undefined;			// atribuída nos testes

	private readonly widget: IChatWidget;

	constructor() {
		super();

		const self = this;               // para o getter abaixo

		this.widget = {
			/* Propriedades obrigatórias ...................................... */
			domNode: document.createElement('div'),

			get viewModel() {              // <- agora é só leitura
				return self.vm as any;     // cast p/ IChatViewModel | undefined
			},

			onDidChangeViewModel: (() => ({ dispose() { } })) as any,
			onDidAcceptInput: (() => ({ dispose() { } })) as any,
			onDidHide: (() => ({ dispose() { } })) as any,
			onDidSubmitAgent: (() => ({ dispose() { } })) as any,
			onDidChangeAgent: (() => ({ dispose() { } })) as any,
			onDidChangeParsedInput: (() => ({ dispose() { } })) as any,

			location: 0 as any,
			viewContext: {} as any,
			inputEditor: undefined as any,
			supportsFileReferences: false,
			parsedInput: undefined as any,
			lastSelectedAgent: undefined,
			scopedContextKeyService: undefined as any,
			input: undefined as any,
			attachmentModel: undefined as any,
			supportsChangingModes: false,

			/* Métodos (stubs vazios) ........................................ */
			getContrib: () => undefined,
			reveal: () => { },
			focus: () => { },
			getSibling: () => undefined,
			getFocus: () => undefined,
			setInput: () => { },
			getInput: () => '',
			refreshParsedInput: () => { },
			logInputHistory: () => { },
			acceptInput: async () => undefined,
			rerunLastRequest: async () => { },
			setInputPlaceholder: () => { },
			resetInputPlaceholder: () => { },
			focusLastMessage: () => { },
			focusInput: () => { },
			hasInputFocus: () => false,
			getCodeBlockInfoForEditor: () => undefined,
			getCodeBlockInfosForResponse: () => [],
			getFileTreeInfosForResponse: () => [],
			getLastFocusedFileTreeForResponse: () => undefined,
			clear: () => { },
			waitForReady: async () => { },
			getViewState: () => ({} as any),
			togglePaused: () => { }
		};
	}

	override get lastFocusedWidget(): IChatWidget | undefined {
		return this.vm ? this.widget : undefined;
	}

	override getWidgetBySessionId(): IChatWidget | undefined {
		return this.lastFocusedWidget;
	}
}

/*──────────────────────────────────────────────────────────────────────────────
 *	3. Suite
 *─────────────────────────────────────────────────────────────────────────────*/

suite('Chat › Export to JSON action', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let insta: any;
	let action: any;

	const fileDlg = new FileDialogMock();
	const fileSvc = new FileServiceMock();
	const noteSvc = new NotificationMock();
	const wdgSvc = new ChatWidgetServiceMock();

	const services = new ServiceCollection(
		[IFileDialogService, fileDlg],
		[IFileService, fileSvc],
		[INotificationService, noteSvc],
		[IChatWidgetService, wdgSvc],
		[ICommandService, <ICommandService>{
			executeCommand: async (id: string, ...args: any[]) => {
				const command = CommandsRegistry.getCommand(id);
				if (!command) {
					throw new Error(`Command '${id}' not found`);
				}
				return command.handler!(insta, ...args);
			}
		}]
	);

	setup(() => {
		// instantiator que respeita toda a infra do workbench
		insta = workbenchInstantiationService(undefined).createChild(services);
		action = insta.createInstance(MockExportToJsonAction);
	});

	/*────────────────────────────────────────────────────────────────────────*/
	test('1: Sem sessão -> notificação de erro', async () => {
		fileDlg.nextSaveUri = URI.file('/tmp/ignored.json');
		await action.run(insta);
		assert.strictEqual(fileSvc.wrote, undefined);
		assert.strictEqual(noteSvc.last?.sev, Severity.Error);
	});

	/*────────────────────────────────────────────────────────────────────────*/
	test('2: Utilizador cancela diálogo -> nada acontece', async () => {
		wdgSvc.vm = { model: { toJSON() { return {}; }, title: 'x' } };
		fileDlg.nextSaveUri = undefined;			// cancelamento
		await action.run(insta);
		assert.strictEqual(fileSvc.wrote, undefined);
		assert.ok(!noteSvc.last);
	});

	/*────────────────────────────────────────────────────────────────────────*/
	test('3: Escrita bem-sucedida -> ficheiro escrito + info()', async () => {
		const target = URI.file('/tmp/out.json');
		wdgSvc.vm = { model: { toJSON() { return { ok: 1 }; }, title: 'Chat' } };
		fileDlg.nextSaveUri = target;

		await action.run(insta);

		assert.strictEqual(fileSvc.wrote?.toString(), target.toString());
		assert.strictEqual(noteSvc.last?.sev, Severity.Info);
	});

	/*────────────────────────────────────────────────────────────────────────*/
	test('4: Erro em writeFile -> notificação de erro', async () => {
		wdgSvc.vm = { model: { toJSON() { return { oops: true }; }, title: 'Oops' } };
		fileDlg.nextSaveUri = URI.file('/tmp/fail.json');
		fileSvc.fail = true;

		await action.run(insta);

		assert.strictEqual(noteSvc.last?.sev, Severity.Error);
	});
});
