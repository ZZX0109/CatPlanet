import fs from "node:fs";
import path from "node:path";

export function fileError(code, message) {
  return Object.assign(Error(message), { code });
}

// Reject links in every existing path component, including broken links.
export function noLinks(file) {
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  for (const part of absolute
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw fileError("IO_ERROR", "Symlink paths are not permitted");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return absolute;
}

// Keep the final file open while checking and reading it. O_NOFOLLOW also closes
// the final-component check/open race; bounded reads reject files that grow.
export function readBoundedFile(file, maxBytes, code = "FILES_INVALID") {
  const absolute = noLinks(file);
  const fd = fs.openSync(
    absolute,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes)
      throw fileError(code, `Expected regular file under ${maxBytes} bytes`);
    const chunks = [];
    let total = 0;
    while (total <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(65536, maxBytes + 1 - total));
      const count = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!count) return Buffer.concat(chunks, total);
      chunks.push(chunk.subarray(0, count));
      total += count;
    }
    throw fileError(code, `File exceeds ${maxBytes} bytes`);
  } finally {
    fs.closeSync(fd);
  }
}
