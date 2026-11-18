import * as vscode from 'vscode';
import { Language, LANGUAGES, findByVsCodeId } from './languages';
import { buildPrompt, cleanResponse } from './prompt';
import { callGemini } from './gemini';

type LanguageItem = vscode.QuickPickItem & { lang: Language };

function toItems(langs: Language[]): LanguageItem[] {
    return langs.map(lang => ({ label: lang.name, lang }));
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

        // 1. Selection if there is one, otherwise the whole file
        const selection = editor.selection;
        const code = selection.isEmpty
            ? editor.document.getText()
            : editor.document.getText(selection);

        if (code.trim() === '') {
            vscode.window.showErrorMessage('SyntaxSwap: there is no code to convert.');
            return;
        }

        // 2. Detect the source language, or ask if it is not in our list
        let source = findByVsCodeId(editor.document.languageId);
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
        const model = config.get<string>('model', 'gemini-flash-lite-latest');
        const timeoutSeconds = config.get<number>('timeoutSeconds', 30);

        log.show(true);
        log.appendLine(`--- ${from.name} to ${target.name} ---`);

        // 6. Convert with a progress notification
        await vscode.window.withProgress(
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

                    const result = cleanResponse(raw);
                    if (result === '') {
                        throw new Error('The model returned an empty response. Try again.');
                    }

                    const doc = await vscode.workspace.openTextDocument({
                        content: result,
                        language: target.id
                    });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                    log.appendLine('Done.');
                } catch (err: any) {
                    log.appendLine('FAILED: ' + err.message);
                    vscode.window.showErrorMessage('SyntaxSwap: conversion failed. ' + err.message);
                }
            }
        );
    });

    context.subscriptions.push(setKey, convert, log);
}

export function deactivate() {}