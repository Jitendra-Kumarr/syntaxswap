export function buildPrompt(code: string, from: string, to: string): string {
    return [
        `Convert the following ${from} code to ${to}.`,
        'Rules:',
        '- Keep the same logic and behavior.',
        '- Preserve comments, translating them if needed.',
        `- Use idiomatic ${to} and its standard library equivalents.`,
        `- Add the imports or includes that the ${to} code needs.`,
        '- If something cannot be translated directly, add a short comment explaining the change.',
        `Return ONLY the ${to} code, with no explanations and no markdown fences.`,
        '',
        code
    ].join('\n');
}

// Models sometimes wrap code in ``` fences even when told not to.
export function cleanResponse(text: string): string {
    return text
        .trim()
        .replace(/^```[\w+#-]*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .trim();
}