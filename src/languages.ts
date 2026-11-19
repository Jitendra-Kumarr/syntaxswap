// An "interface" describes the shape of an object, like a Java class with only fields.
export interface Language {
    name: string; // shown to the user and used in the prompt
    id: string;   // VS Code's language id
    ext: string;  // file extension used by "Save as file"
}

export const LANGUAGES: Language[] = [
    { name: 'Python', id: 'python', ext: '.py' },
    { name: 'Java', id: 'java', ext: '.java' },
    { name: 'JavaScript', id: 'javascript', ext: '.js' },
    { name: 'C', id: 'c', ext: '.c' },
    { name: 'C++', id: 'cpp', ext: '.cpp' }
];

// "Language | undefined" means: a Language, or nothing if no match is found.
export function findByVsCodeId(id: string): Language | undefined {
    return LANGUAGES.find(l => l.id === id);
}