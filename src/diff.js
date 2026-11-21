// Parses unified diff text (as produced by `git diff`) into files and hunks.

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let newLine = 0;

  const startFile = (oldPath, newPath) => {
    file = { oldPath, newPath, path: newPath, status: 'modified', binary: false, hunks: [] };
    files.push(file);
    hunk = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('diff --git ')) {
      const m = raw.match(/^diff --git a\/(.+) b\/(.+)$/);
      startFile(m ? m[1] : null, m ? m[2] : null);
      continue;
    }
    if (!file) continue;

    if (!hunk) {
      if (raw.startsWith('new file mode')) file.status = 'added';
      else if (raw.startsWith('deleted file mode')) file.status = 'deleted';
      else if (raw.startsWith('rename from ')) { file.oldPath = raw.slice(12); file.status = 'renamed'; }
      else if (raw.startsWith('rename to ')) file.newPath = raw.slice(10);
      else if (raw.startsWith('Binary files ')) file.binary = true;
      else if (raw.startsWith('--- ')) file.oldPath = stripPrefix(raw.slice(4)) ?? file.oldPath;
      else if (raw.startsWith('+++ ')) file.newPath = stripPrefix(raw.slice(4)) ?? file.newPath;
      file.path = file.status === 'deleted' ? file.oldPath : file.newPath;
    }

    const header = raw.match(HUNK_HEADER);
    if (header) {
      newLine = Number(header[3]);
      hunk = {
        header: raw,
        context: header[5].trim(),
        oldStart: Number(header[1]),
        newStart: newLine,
        line: null,
        added: [],
        removed: [],
      };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    if (raw.startsWith('+')) {
      hunk.added.push(raw.slice(1));
      hunk.line ??= newLine;
      newLine++;
    } else if (raw.startsWith('-')) {
      hunk.removed.push(raw.slice(1));
      hunk.line ??= newLine;
    } else if (raw.startsWith(' ')) {
      newLine++;
    }
  }

  for (const f of files) for (const h of f.hunks) h.line ??= h.newStart;
  return files;
}

function stripPrefix(p) {
  if (p === '/dev/null') return null;
  return p.replace(/^[ab]\//, '');
}
