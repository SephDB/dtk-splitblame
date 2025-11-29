// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { logMessage } from './debug';
import { SymbolManager } from './SymbolManager';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	logMessage('Congratulations, your extension "dtk-splitblame" is now active!');

	//Mapping of symbols.txt uri to the corresponding symbol manager
	const symbols:Map<vscode.Uri,SymbolManager> = new Map();

	//One set per tab group, set of URIs that are active within each.
	const active_tabs:Array<Set<vscode.Uri>> = new Array();
	active_tabs.push(new Set()); //1-indexed
	vscode.window.tabGroups.all.forEach(() => active_tabs.push(new Set()));

	context.subscriptions.push(vscode.commands.registerTextEditorCommand('dtk-splitblame.toggle', async (editor:vscode.TextEditor) => {
		const symbols_uri = editor.document.uri;
		let symbolmanager = symbols.get(symbols_uri);
		if(!symbolmanager) {
			try {
				symbolmanager = await SymbolManager.Create(editor.document,active_tabs);
				context.subscriptions.push(symbolmanager);
			}
			catch {
				logMessage("Missing splits.txt alongside symbols.txt!");
				return;
			}
			symbols.set(symbols_uri,symbolmanager);
		}
		
		const editor_tabgroup = active_tabs[editor.viewColumn!];
		if(editor_tabgroup.has(editor.document.uri)) {
			logMessage("Closing blame for ",editor.document.fileName);
			symbolmanager.close(editor);
			editor_tabgroup.delete(editor.document.uri);
		}
		else {
			logMessage("Opening blame for ",editor.document.fileName);
			editor_tabgroup.add(editor.document.uri);
			symbolmanager!.open(editor);
		}
	}));

	vscode.window.tabGroups.onDidChangeTabGroups(e => {
		e.closed.forEach(e => {
			active_tabs.splice(e.viewColumn,1);
		});
		e.opened.forEach(e => {
			active_tabs.splice(e.viewColumn,0,new Set());
		});
	}, null, context.subscriptions);

	vscode.window.tabGroups.onDidChangeTabs(e => {
		e.closed.forEach(t => {
			if(t.input instanceof vscode.TabInputText) {
				active_tabs[t.group.viewColumn].delete(t.input.uri);
			}
		});
	}, null, context.subscriptions);

	vscode.workspace.onDidCloseTextDocument(e => {
		let s = symbols.get(e.uri);
		if(s) {
			s.dispose();
			context.subscriptions.splice(context.subscriptions.indexOf(s),1);
			symbols.delete(e.uri);
		}
	}, null, context.subscriptions);

	vscode.window.onDidChangeActiveTextEditor((editor:vscode.TextEditor|undefined) => {
		if(editor && editor.viewColumn && active_tabs[editor.viewColumn].has(editor.document.uri)) {
			symbols.get(editor.document.uri)?.open(editor);
		}
	}, null, context.subscriptions);

	context.subscriptions.push(vscode.languages.registerHoverProvider('*', {
		provideHover(document, position, _token) {
			if(position.character !== 0) {
				return undefined;
			}
			const hover = symbols.get(document.uri)?.getHover(position.line);
			if(hover) {
				return new vscode.Hover(hover);
			}
			return undefined;
		},
	}));
}

// This method is called when your extension is deactivated
export function deactivate() {}
