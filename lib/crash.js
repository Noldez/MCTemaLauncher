// Crash forensics: a bounded tail of the game console plus a small heuristic
// that names the likeliest culprit for the crash dialog. Pure Node so both
// pieces stay unit-testable outside Electron.

/**
 * Rolling line buffer bounded by bytes. Old lines fall off the front, so what
 * remains is always the tail of the console - the part a crash lives in.
 * @param {number} [maxBytes]
 */
function createLogBuffer(maxBytes = 256 * 1024) {
  /** @type {string[]} */
  let lines = [];
  let size = 0;
  return {
    /** @param {unknown} line */
    push(line) {
      const s = String(line);
      lines.push(s);
      size += s.length + 1;
      while (size > maxBytes && lines.length > 1) {
        size -= lines[0].length + 1;
        lines.shift();
      }
      if (size > maxBytes) {
        // A single line larger than the whole cap: keep its end, where the
        // stacktrace that matters is.
        lines[0] = lines[0].slice(-maxBytes);
        size = lines[0].length + 1;
      }
    },
    reset() {
      lines = [];
      size = 0;
    },
    text() {
      return lines.join('\n');
    },
  };
}

const JAR_RE = /([A-Za-z0-9_+.-]+\.jar)/g;
// Loader and vanilla jars appear in every stacktrace and are never the answer.
const BORING_JAR_RE = /^(minecraft|fabric-loader|server)[-.]/i;

/**
 * Likeliest culprit line for the crash dialog: a mod jar mentioned near the
 * end of the log wins (that is what players and mods can act on), then the
 * last "Caused by:", then the last exception-looking line. Null when the log
 * has nothing to point at.
 * @param {unknown} logText
 */
function suspectCause(logText) {
  if (!logText) return null;
  const tail = String(logText).split('\n').slice(-120);
  let jar = null;
  let causedBy = null;
  let exception = null;
  for (const line of tail) {
    for (const match of line.match(JAR_RE) || []) {
      if (!BORING_JAR_RE.test(match)) jar = match;
    }
    if (/^\s*Caused by:/.test(line)) causedBy = line.trim();
    else if (/\b[A-Za-z0-9_.]*(?:Exception|Error)\b/.test(line)) exception = line.trim();
  }
  const cause = jar || causedBy || exception;
  return cause ? cause.slice(0, 200) : null;
}

module.exports = { createLogBuffer, suspectCause };
