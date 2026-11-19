import * as vscode from 'vscode';
import * as path from 'path';
import { Language, LANGUAGES, findByVsCodeId } from './languages';
import { buildPrompt, cleanResponse } from './prompt';
import { callGemini } from './gemini';

// A quick-pick row that also carries the Language it stands for.
type LanguageItem = vscode.QuickPickItem & { lang: Language };

function toItems(langs: Language[]): LanguageItem[] {
    return langs.map(lang => ({ label: lang.name, lang }));
}

// After a conversion, ask what to do with the result.
async function offerActions(
    editor: vscode.TextEditor,
    range: vscode.Range,
    wholeFile: boolean,
    result: string,
    target: Language
): Promise<void> {
    const REPLACE = 'Replace original';
    const COPY = 'Copy';
    const SAVE = 'Save as file';

    // Shows a message with buttons. Returns the clicked button's text, or undefined if dismissed.
    const choice = await vscode.window.showInformationMessage(
        `SyntaxSwap: converted to ${target.name}.`,
        REPLACE, COPY, SAVE
    );

    if (choice === REPLACE) {
        // Bring the original editor back, then swap the text in the saved range.
        const original = await vscode.window.showTextDocument(editor.document, editor.viewColumn);
        await original.edit(builder => builder.replace(range, result));

        // If the whole file was replaced, switch its language so the old
        // language's error checker stops flagging the new code.
        if (wholeFile) {
            await vscode.languages.setTextDocumentLanguage(original.document, target.id);
        }
    } else if (choice === COPY) {
        await vscode.env.clipboard.writeText(result);
        vscode.window.showInformationMessage('SyntaxSwap: copied to clipboard.');
    } else if (choice === SAVE) {
        // Suggest a name next to the original: test.java -> test.py
        let defaultUri: vscode.Uri | undefined;
        if (editor.document.uri.scheme === 'file') {
            const parsed = path.parse(editor.document.uri.fsPath);
            defaultUri = vscode.Uri.file(path.join(parsed.dir, parsed.name + target.ext));
        }
        const uri = await vscode.window.showSaveDialog({ defaultUri });
        if (!uri) { return; } // user cancelled

        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(result));
        const saved = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(saved, vscode.ViewColumn.Beside);
    }
}

export function activate(context: vscode.ExtensionContext) {
    const log = vscode.window.createOutputChannel('SyntaxSwap');

    // Command 1: save the Gemini API key securely
    const setKey = vscode.commands.registerCommand('syntaxswap.setApiKey', async () => {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Gemini API key',
            password: true,
            ignoreFocusOut: true
        });
        if (key) {
            await context.secrets.store('syntaxswapGeminiKey', key.trim());
            vscode.window.showInformationMessage('SyntaxSwap: API key saved.');
        }
    });

    // Command 2: convert code
    const convert = vscode.commands.registerCommand('syntaxswap.convert', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('SyntaxSwap: open a code file first.');
            return;
        }

        // 1. The range to convert: the selection, or the whole file if nothing is selected.
        const doc = editor.document;
        const wholeFile = editor.selection.isEmpty;
        const range: vscode.Range = wholeFile
            ? new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length))
            : editor.selection;
        const code = doc.getText(range);

        if (code.trim() === '') {
            vscode.window.showErrorMessage('SyntaxSwap: there is no code to convert.');
            return;
        }

        // 2. Detect the source language, or ask if it is not in our list
        let source = findByVsCodeId(doc.languageId);
        if (!source) {
            const pickedSource = await vscode.window.showQuickPick(toItems(LANGUAGES), {
                placeHolder: 'Could not detect the language. Which language is this code?'
            });
            if (!pickedSource) { return; }
            source = pickedSource.lang;
        }
        const from = source;

        // 3. Pick the target language (everything except the source)
        const pickedTarget = await vscode.window.showQuickPick(
            toItems(LANGUAGES.filter(l => l.id !== from.id)),
            { placeHolder: `Convert ${from.name} to which language?` }
        );
        if (!pickedTarget) { return; }
        const target = pickedTarget.lang;

        // 4. API key
        const apiKey = await context.secrets.get('syntaxswapGeminiKey');
        if (!apiKey) {
            vscode.window.showErrorMessage('SyntaxSwap: run "SyntaxSwap: Set Gemini API Key" first.');
            return;
        }

        // 5. Settings
        const config = vscode.workspace.getConfiguration('syntaxswap');
        const model = config.get<string>('model', 'gemini-flash-lite-latest').trim();
        const timeoutSeconds = config.get<number>('timeoutSeconds', 30);

        log.show(true);
        log.appendLine(`--- ${from.name} to ${target.name} ---`);

        // 6. Convert with a progress notification.
        // The callback returns the converted text, or undefined if it failed.
        const result = await vscode.window.withProgress<string | undefined>(
            {
                location: vscode.ProgressLocation.Notification,
                title: `SyntaxSwap: converting ${from.name} to ${target.name}...`
            },
            async () => {
                try {
                    const prompt = buildPrompt(code, from.name, target.name);
                    const raw = await callGemini(
                        prompt,
                        { apiKey, model, timeoutMs: timeoutSeconds * 1000, maxAttempts: 3 },
                        log
                    );

                    const cleaned = cleanResponse(raw);
                    if (cleaned === '') {
                        throw new Error('The model returned an empty response. Try again.');
                    }

                    log.appendLine('Done.');
                    return cleaned;
                } catch (err: any) {
                    log.appendLine('FAILED: ' + err.message);
                    vscode.window.showErrorMessage('SyntaxSwap: conversion failed. ' + err.message);
                    return undefined;
                }
            }
        );

        if (result === undefined) { return; }

        // 7. Show the result beside the original, then offer the actions.
        const resultDoc = await vscode.workspace.openTextDocument({
            content: result,
            language: target.id
        });
        await vscode.window.showTextDocument(resultDoc, vscode.ViewColumn.Beside);

        await offerActions(editor, range, wholeFile, result, target);
    });

    context.subscriptions.push(setKey, convert, log);
}

export function deactivate() {}