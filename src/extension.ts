import * as vscode from 'vscode';
import * as path from 'path';
import { Language, LANGUAGES, findByVsCodeId } from './languages';
import { buildPrompt, cleanResponse } from './prompt';
import { callGemini } from './gemini';
import { CheckResult, validateCode } from './validate';

type LanguageItem = vscode.QuickPickItem & { lang: Language };

function toItems(langs: Language[]): LanguageItem[] {
    return langs.map(lang => ({ label: lang.name, lang }));
}

// After a conversion, report the syntax check and ask what to do with the result.
async function offerActions(
    editor: vscode.TextEditor,
    range: vscode.Range,
    wholeFile: boolean,
    result: string,
    target: Language,
    check: CheckResult
): Promise<void> {
    const REPLACE = 'Replace original';
    const COPY = 'Copy';
    const SAVE = 'Save as file';

    let choice: string | undefined;
    if (check.status === 'errors') {
        choice = await vscode.window.showWarningMessage(
            `SyntaxSwap: converted to ${target.name}, but the syntax check found errors (see the SyntaxSwap output).`,
            REPLACE, COPY, SAVE
        );
    } else {
        const note = check.status === 'ok'
            ? 'Syntax check passed.'
            : `Syntax check skipped (${check.reason}).`;
        choice = await vscode.window.showInformationMessage(
            `SyntaxSwap: converted to ${target.name}. ${note}`,
            REPLACE, COPY, SAVE
        );
    }

    if (choice === REPLACE) {
        const original = await vscode.window.showTextDocument(editor.document, editor.viewColumn);
        await original.edit(builder => builder.replace(range, result));
        if (wholeFile) {
            await vscode.languages.setTextDocumentLanguage(original.document, target.id);
        }
    } else if (choice === COPY) {
        await vscode.env.clipboard.writeText(result);
        vscode.window.showInformationMessage('SyntaxSwap: copied to clipboard.');
    } else if (choice === SAVE) {
        let defaultUri: vscode.Uri | undefined;
        if (editor.document.uri.scheme === 'file') {
            const parsed = path.parse(editor.document.uri.fsPath);
            defaultUri = vscode.Uri.file(path.join(parsed.dir, parsed.name + target.ext));
        }
        const uri = await vscode.window.showSaveDialog({ defaultUri });
        if (!uri) { return; }

        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(result));
        const saved = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(saved, vscode.ViewColumn.Beside);
    }
}

export function activate(context: vscode.ExtensionContext) {
    const log = vscode.window.createOutputChannel('SyntaxSwap');

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

    const convert = vscode.commands.registerCommand('syntaxswap.convert', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('SyntaxSwap: open a code file first.');
            return;
        }

        // 1. The range to convert: the selection, or the whole file.
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

        // 2. Source language
        let source = findByVsCodeId(doc.languageId);
        if (!source) {
            const pickedSource = await vscode.window.showQuickPick(toItems(LANGUAGES), {
                placeHolder: 'Could not detect the language. Which language is this code?'
            });
            if (!pickedSource) { return; }
            source = pickedSource.lang;
        }
        const from = source;

        // 3. Target language
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
        const validate = config.get<boolean>('validate', true);

        log.show(true);
        log.appendLine(`--- ${from.name} to ${target.name} ---`);
        log.appendLine(wholeFile
            ? `Input: whole file (${code.length} characters)`
            : `Input: selection (${code.length} characters)`);

        // 6. Convert, then validate, under one progress notification.
        const outcome = await vscode.window.withProgress<{ text: string; check: CheckResult } | undefined>(
            {
                location: vscode.ProgressLocation.Notification,
                title: `SyntaxSwap: converting ${from.name} to ${target.name}...`
            },
            async progress => {
                try {
                    const prompt = buildPrompt(code, from.name, target.name, !wholeFile);
                    const raw = await callGemini(
                        prompt,
                        { apiKey, model, timeoutMs: timeoutSeconds * 1000, maxAttempts: 3 },
                        log
                    );

                    const cleaned = cleanResponse(raw);
                    if (cleaned === '') {
                        throw new Error('The model returned an empty response. Try again.');
                    }
                    log.appendLine('Conversion done.');

                    // A selected fragment is not a complete program, so only whole files are checked.
                    let check: CheckResult = {
                        status: 'skipped',
                        reason: !validate ? 'validation is turned off' : 'a selection is only a fragment'
                    };
                    if (validate && wholeFile) {
                        progress.report({ message: 'checking syntax...' });
                        check = await validateCode(cleaned, target);
                        if (check.status === 'ok') {
                            log.appendLine('Syntax check: passed.');
                        } else if (check.status === 'skipped') {
                            log.appendLine(`Syntax check: skipped (${check.reason}).`);
                        } else {
                            log.appendLine('Syntax check: ERRORS found:');
                            log.appendLine(check.details);
                        }
                    } else {
                        log.appendLine(`Syntax check: skipped (${check.reason}).`);
                    }

                    return { text: cleaned, check };
                } catch (err: any) {
                    log.appendLine('FAILED: ' + err.message);
                    vscode.window.showErrorMessage('SyntaxSwap: conversion failed. ' + err.message);
                    return undefined;
                }
            }
        );

        if (outcome === undefined) { return; }

        // 7. Show the result beside the original, then offer the actions.
        const resultDoc = await vscode.workspace.openTextDocument({
            content: outcome.text,
            language: target.id
        });
        await vscode.window.showTextDocument(resultDoc, vscode.ViewColumn.Beside);

        await offerActions(editor, range, wholeFile, outcome.text, target, outcome.check);
    });

    context.subscriptions.push(setKey, convert, log);
}

export function deactivate() {}