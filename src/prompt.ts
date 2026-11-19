export function buildPrompt(code: string, from: string, to: string, fragment: boolean): string {
    const rules = [
        `Convert the following ${from} code to ${to}.`,
        'Rules:',
        '- Keep the same logic and behavior.',
        '- Preserve comments, translating them if needed.',
        `- Use idiomatic ${to} and its standard library equivalents.`,
        '- Do not add unused imports or commented-out code.',
        '- If something cannot be translated directly, add a short comment explaining the change.'
    ];

    if (fragment) {
        rules.push(
            '- The input is only a FRAGMENT selected from a larger file.',
            '- Convert only those lines. Do NOT add a main function, class, entry point, or boilerplate.',
            '- Add no imports or includes.'
        );
    } else {
        rules.push(`- Add the imports or includes that the ${to} code needs.`);
    }

    rules.push(`Return ONLY the ${to} code, with no explanations and no markdown fences.`, '', code);
    return rules.join('\n');
}

// Models sometimes wrap code in ``` fences even when told not to.
export function cleanResponse(text: string): string {
    return text
        .trim()
        .replace(/^```[\w+#-]*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .trim();
}