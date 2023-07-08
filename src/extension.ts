import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

function linkUnitTest() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const document = editor.document;
  const position = editor.selection.active;
  const functionName = getFunctionNameAtPosition(document, position);
  if (!functionName) {
    return;
  }

  const functionFile = document.fileName;
  const { testFile, testRange } = getTestFilePath(functionFile, functionName);
  if (!testFile || !testRange) {
    vscode.window.showInformationMessage(
      `No unit test found for function "${functionName}"`
    );
    return;
  }

  const testUri = vscode.Uri.file(testFile);
  vscode.workspace.openTextDocument(testUri).then((doc) => {
    vscode.window.showTextDocument(doc, { selection: testRange });
  });
}

function getFunctionNameAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): string | undefined {
  const wordRange = document.getWordRangeAtPosition(position);
  if (wordRange) {
    return document.getText(wordRange);
  }

  return undefined;
}

function getTestFilePath(
  functionFile: string,
  functionName: string
): { testFile?: string; testRange?: vscode.Range } {
  const functionDir = path.dirname(functionFile);
  const { relativeFunctionDir, rootDir } = getRelativePath(functionDir);
  if (!relativeFunctionDir || !rootDir) {
    vscode.window.showInformationMessage(
      `No workspace folders found that match the current function dir: functionDir=${functionDir} - vscode.workspace.workspaceFolders=${JSON.stringify(
        vscode.workspace.workspaceFolders
      )}`
    );
    return {};
  }
  let currentDir = functionDir;

  while (true) {
    const files = fs.readdirSync(currentDir);
    for (const file of files) {
      const testFile = path.join(currentDir, file);
      const stat = fs.statSync(testFile);
      if (stat.isFile() && file.endsWith(".test.ts")) {
        const testRange = findTestRange(testFile, functionName);
        if (testRange) {
          return { testFile, testRange };
        }
      }
    }

    const parentDir = path.dirname(currentDir);
    if (currentDir === parentDir || currentDir === rootDir) {
      break;
    }

    currentDir = parentDir;
  }

  return {};
}

function getRelativePath(dir: string): {
  relativeFunctionDir?: string;
  rootDir?: string;
} {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    vscode.window.showInformationMessage(
      `No workspace folders found: vscode.workspace.workspaceFolders=${vscode.workspace.workspaceFolders}`
    );
    return {};
  }
  for (const workspaceFolder of workspaceFolders) {
    const rootDir = workspaceFolder.uri.fsPath;
    if (dir.startsWith(rootDir)) {
      return { relativeFunctionDir: path.relative(rootDir, dir), rootDir };
    }
  }
  return {};
}

function findTestRange(
  testFile: string,
  functionName: string
): vscode.Range | undefined {
  const testText = fs.readFileSync(testFile, "utf8");
  const describeRegex = new RegExp(
    `describe\\s*\\(\\s*['"\`]${functionName}['"\`]`
  );
  const describeMatch = testText.match(describeRegex);

  if (describeMatch) {
    const describeLine = testText
      .substring(0, describeMatch.index)
      .split("\n").length;
    const startLine = describeLine - 1;
    const endLine = startLine + describeMatch[0].split("\n").length;

    return new vscode.Range(startLine, 0, endLine, 0);
  }

  return undefined;
}

function updateDecorations(
  editor: vscode.TextEditor,
  decorationType: vscode.TextEditorDecorationType
) {
  const document = editor.document;
  if (!isTSFile(document.fileName)) {
    return;
  }
  const decorations: vscode.DecorationOptions[] = [];
  const constRegex = /^export\s+const\s+(\w+)/;
  const functionRegex = /^export\s+function\s+(\w+)/;

  for (let i = 0; i < document.lineCount; i++) {
    const line = document.lineAt(i);
    const functionName =
      line.text.match(constRegex)?.[1] || line.text.match(functionRegex)?.[1];
    if (functionName) {
      const hasTests = getTestFilePath(
        document.fileName,
        functionName
      )?.testFile;
      if (hasTests) {
        const decoration = {
          range: new vscode.Range(line.range.start, line.range.end),
          hoverMessage: "Covered by unit tests ✅",
        };
        decorations.push(decoration);
      }
    }
  }

  editor.setDecorations(decorationType, decorations);
}

function isTSFile(fileName: string): boolean {
  return /\.ts$/i.test(fileName) && !/\.[^\.]+\.ts$/i.test(fileName);
}

function activateCheckmark(context: vscode.ExtensionContext) {
  let timeout: NodeJS.Timer | undefined = undefined;
  let activeEditor = vscode.window.activeTextEditor;
  const decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(0,100,0,0.3)",
  });

  function triggerUpdateDecorations(throttle = false) {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    if (!activeEditor) {
      throw new Error("no active editor");
    }
    if (throttle) {
      timeout = ((editor) =>
        setTimeout(() => updateDecorations(editor, decorationType), 500))(
        activeEditor
      );
    } else {
      updateDecorations(activeEditor, decorationType);
    }
  }

  if (activeEditor) {
    triggerUpdateDecorations();
  }

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      activeEditor = editor;
      if (editor) {
        triggerUpdateDecorations();
      }
    },
    null,
    context.subscriptions
  );

  vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (activeEditor && event.document === activeEditor.document) {
        triggerUpdateDecorations(true);
      }
    },
    null,
    context.subscriptions
  );
}

function activateGoToUnitTest(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "go-to-unit-test.execute",
    () => {
      linkUnitTest();
    }
  );

  context.subscriptions.push(disposable);
}

export function activate(context: vscode.ExtensionContext) {
  activateGoToUnitTest(context);
  activateCheckmark(context);
}
