export interface Language {
    name: string;
    id: string;
}

export const LANGUAGES: Language[] = [
    { name: 'Python', id: 'python' },
    { name: 'Java', id: 'java' },
    { name: 'JavaScript', id: 'javascript' },
    { name: 'TypeScript', id: 'typescript' },
    { name: 'C', id: 'c' },
    { name: 'C++', id: 'cpp' },
    { name: 'Go', id: 'go' },
    { name: 'Rust', id: 'rust' }
];

export function findByVsCodeId(id: string): Language | undefined {
    return LANGUAGES.find(l => l.id === id);
}