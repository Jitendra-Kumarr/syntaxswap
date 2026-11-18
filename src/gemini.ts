import * as vscode from 'vscode';

export interface GeminiOptions {
    apiKey: string;
    model: string;
    timeoutMs: number;
    maxAttempts: number;
}

class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export async function callGemini(
    prompt: string,
    opts: GeminiOptions,
    log: vscode.OutputChannel
): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent`;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        const started = Date.now();
        log.appendLine(`Attempt ${attempt}/${opts.maxAttempts} using ${opts.model}...`);

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': opts.apiKey
                },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
                signal: AbortSignal.timeout(opts.timeoutMs)
            });

            const seconds = ((Date.now() - started) / 1000).toFixed(1);
            log.appendLine(`  HTTP ${res.status} after ${seconds}s`);

            if (res.ok) {
                const data: any = await res.json();
                return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            }

            throw new ApiError(res.status, `Gemini API ${res.status}: ${await res.text()}`);
        } catch (err: any) {
            const cause = err.cause ? ` (${err.cause.code ?? err.cause.message})` : '';
            log.appendLine(`  Error: ${err.message}${cause}`);

            // API errors retry only when temporary (503 overloaded, 429 rate limited).
            // Network errors and timeouts always retry.
            const retryable = err instanceof ApiError
                ? err.status === 503 || err.status === 429
                : true;

            if (!retryable || attempt === opts.maxAttempts) {
                if (!(err instanceof ApiError) && cause) {
                    err.message += cause;
                }
                throw err;
            }

            const waitMs = 2000 * attempt;
            log.appendLine(`  Retrying in ${waitMs / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }

    throw new Error('Unknown error');
}