import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Language } from './languages';

// A "union type": a CheckResult is exactly one of these three shapes.
export type CheckResult =
    | { status: 'ok' }
    | { status: 'errors'; details: string }
    | { status: 'skipped'; reason: string };

interface RunResult {
    ok: boolean;
    output: string;
    missing: boolean;  // the tool is not installed
    timedOut: boolean;
}

// Runs a command and always resolves (never throws), so callers can inspect the outcome.
function run(cmd: string, args: string[], cwd: string): Promise<RunResult> {
    return new Promise(resolve => {
        execFile(cmd, args, { cwd, timeout: 15000 }, (error, stdout, stderr) => {
            const output = `${stderr}${stdout}`.trim();
            if (!error) {
                resolve({ ok: true, output, missing: false, timedOut: false });
                return;
            }
            const e = error as NodeJS.ErrnoException & { killed?: boolean };
            resolve({
                ok: false,
                output,
                missing: e.code === 'ENOENT',
                timedOut: !!e.killed
            });
        });
    });
}

// Java requires the file name to match the public class name.
function javaFileName(code: string): string {
    const m = code.match(/public\s+(?:final\s+|abstract\s+)*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/);
    return (m ? m[1] : 'Main') + '.java';
}

interface Checker {
    file: string;
    cmd: string;
    args: (file: string) => string[];
}

function checkerFor(lang: Language, code: string): Checker | undefined {
    switch (lang.id) {
        case 'python':
            return {
                file: 'converted.py',
                cmd: 'python3',
                args: f => ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', f]
            };
        case 'javascript':
            return { file: 'converted.js', cmd: 'node', args: f => ['--check', f] };
        case 'c':
            return { file: 'converted.c', cmd: 'gcc', args: f => ['-fsyntax-only', '-x', 'c', f] };
        case 'cpp':
            return { file: 'converted.cpp', cmd: 'g++', args: f => ['-fsyntax-only', '-x', 'c++', f] };
        case 'java':
            return {
                file: javaFileName(code),
                cmd: 'javac',
                args: f => ['-proc:none', '-d', path.dirname(f), f]
            };
        default:
            return undefined;
    }
}

export async function validateCode(code: string, lang: Language): Promise<CheckResult> {
    const checker = checkerFor(lang, code);
    if (!checker) {
        return { status: 'skipped', reason: `no checker for ${lang.name}` };
    }

    // Write the code to a private temp folder so we never touch the user's files.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syntaxswap-'));
    try {
        const file = path.join(dir, checker.file);
        await fs.writeFile(file, code, 'utf8');

        const res = await run(checker.cmd, checker.args(file), dir);

        if (res.missing) {
            return { status: 'skipped', reason: `${checker.cmd} is not installed` };
        }
        if (res.timedOut) {
            return { status: 'skipped', reason: 'the check took too long' };
        }
        if (!res.ok && /xcode-select|Unable to locate a Java Runtime|No Java runtime/i.test(res.output)) {
            return { status: 'skipped', reason: `${checker.cmd} is not set up on this machine` };
        }
        if (res.ok) {
            return { status: 'ok' };
        }

        const details = res.output
            .split(dir + path.sep).join('')
            .split('\n')
            .slice(0, 20)
            .join('\n');
        return { status: 'errors', details };
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}