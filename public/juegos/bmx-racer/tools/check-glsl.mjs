#!/usr/bin/env node
/**
 * Guard: no backticks inside GLSL template literals.
 *
 * A backtick in a GLSL comment terminates the template literal early. The rest
 * of the shader is then parsed as TypeScript, and you get a cryptic
 * "',' expected" hundreds of lines away from the actual mistake. It has cost
 * this repo three debugging cycles.
 *
 * THE FIRST VERSION OF THIS GUARD CONTAINED THE BUG IT EXISTS TO CATCH.
 *
 * It walked from the opening backtick to "the matching close", and treated the
 * first backtick at nesting depth zero as that close — which is exactly what
 * the TypeScript parser does, and exactly what makes this failure mode so
 * confusing in the first place. So on malformed input the walker stopped AT the
 * offending backtick, excluded it from the scanned body, and pronounced the
 * file clean. A guard that agrees with the bug is worse than no guard, because
 * it gets trusted. It was caught by a subagent that hit the real failure while
 * the guard was reporting success.
 *
 * This version scans LINE BY LINE and asks a decidable question instead: is
 * there a backtick on a line that is inside a GLSL region and after a `//`?
 * That needs no knowledge of where the literal ends, which is the whole
 * difficulty. Interpolation spans (${...}) are stripped first, since a nested
 * template inside them is legitimate.
 *
 * Run: node tools/check-glsl.mjs   (also wired into `npm run build`)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Remove ${...} spans, honouring nesting, so nested templates are ignored. */
function stripInterpolation(line) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '$' && line[i + 1] === '{') {
      depth++;
      i++;
      continue;
    }
    if (line[i] === '}' && depth > 0) {
      depth--;
      continue;
    }
    if (depth === 0) out += line[i];
  }
  return out;
}

export function scanSource(text) {
  const lines = text.split('\n');
  const problems = [];
  let inGlsl = false;

  for (const [n, raw] of lines.entries()) {
    const line = stripInterpolation(raw);

    if (!inGlsl) {
      const open = line.indexOf('/* glsl */');
      if (open >= 0) {
        // A single-line literal opens and closes on the same line.
        const after = line.slice(open + '/* glsl */'.length);
        if ((after.match(/`/g) || []).length === 1) inGlsl = true;
      }
      continue;
    }

    const cmt = line.indexOf('//');
    if (cmt >= 0 && line.slice(cmt).includes('`')) {
      problems.push({ line: n + 1, text: raw.trim().slice(0, 100) });
      // Keep going. The parser is lost from here, but reporting every offender
      // in one run beats one per rebuild.
      continue;
    }

    // A backtick outside a comment is the genuine close.
    if (line.includes('`')) inGlsl = false;
  }
  return problems;
}

function main() {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    }
  })('src');

  let total = 0;
  for (const f of files) {
    for (const p of scanSource(readFileSync(f, 'utf8'))) {
      console.error(`${f}:${p.line}  backtick inside a GLSL comment\n    ${p.text}`);
      total++;
    }
  }

  if (total) {
    console.error(
      `\n${total} backtick(s) inside GLSL comments.\n` +
        'Each one silently ends the template literal and breaks the TypeScript\n' +
        'parse somewhere else entirely. Rewrite the comment without backticks.',
    );
    process.exit(1);
  }
  console.log(`GLSL comments clean (${files.length} files).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
