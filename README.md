# SyntaxSwap

Convert code between programming languages inside VS Code, using Google Gemini. After converting, SyntaxSwap runs the real compiler or interpreter on the result and tells you whether it is valid.

**Languages:** Python, Java, JavaScript, C, C++

## Setup

1. Get a free API key at [Google AI Studio](https://aistudio.google.com).
2. Press `Cmd/Ctrl+Shift+P` and run **SyntaxSwap: Set Gemini API Key**. The key is stored in VS Code's encrypted secret storage.

## Usage

1. Open a code file. Select some code, or select nothing to convert the whole file.
2. Run **SyntaxSwap: Convert Code** (Command Palette, or right-click in the editor).
3. Pick the target language. The source language is detected automatically.
4. The result opens beside your code. Choose **Replace original**, **Copy** or **Save as file**.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `syntaxswap.model` | `gemini-flash-lite-latest` | Gemini model to use |
| `syntaxswap.timeoutSeconds` | `30` | Seconds to wait per request |
| `syntaxswap.validate` | `true` | Run a syntax check on converted whole files |

## Limitations

- Your code is sent to Google's Gemini API. Do not convert private or proprietary code with a free key.
- The syntax check needs the language's tool installed (`python3`, `node`, `gcc`, `g++`, `javac`). If a tool is missing, the check is skipped.
- A passing syntax check means the code is valid, not that it behaves the same as the original.
- The AI may silently correct mistakes in broken input.

## License

MIT