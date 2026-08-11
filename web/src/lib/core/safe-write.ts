import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cheminReel, droitsExistants } from "@/lib/core/chemin-reel.mjs";

// THE one place every user-layer write goes through. The core's #1 historical
// pain was data-loss (#649/#704/#920/#958); these guards make a web write
// crash-safe + non-clobbering by construction:
//   - atomic: write a UNIQUE temp file (pid + uuid → no concurrent-write race on
//     a single long-lived Next pid) in the SAME dir, then rename (atomic on POSIX),
//     so a kill mid-write can never truncate the real file.
//   - durable: resolve symlinks FIRST. On the VPS the four user-layer files are
//     symlinks into the persistent volume (docker-entrypoint-web.sh); renaming
//     onto the link would replace it with a real file in the container layer,
//     and the write would silently vanish on the next redeploy. Writing through
//     the link keeps the temp file in the volume's own directory, so the rename
//     stays on one filesystem — atomic AND persistent. See chemin-reel.mjs.
//   - backup: optionally snapshot the prior contents to {file}.bak-{ts} before
//     overwriting, so a bad write is recoverable even though user files are gitignored.
//   - same permissions: a rename swaps the inode, so the replacement is born with
//     the umask's mode (644) and the 600 on these PII files vanishes silently.
//     Measured in production on 2026-08-11. We carry the old mode over.

export function atomicWrite(file: string, content: string): void {
  const cible = cheminReel(file);
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  const droits = droitsExistants(cible);
  const tmp = `${cible}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(tmp, content, "utf8");
  // Sur le temporaire, AVANT le rename : entre les deux, le fichier ne doit
  // jamais exister en clair avec des droits plus larges que l'original.
  if (droits !== null) {
    try {
      fs.chmodSync(tmp, droits);
    } catch {
      /* système sans droits POSIX (Windows) : rien à préserver */
    }
  }
  fs.renameSync(tmp, cible);
}

/** Snapshot the file (if it has content) to a timestamped .bak before a write.
 *  Lands next to the REAL file (the volume), so the backup outlives a redeploy
 *  exactly like the file it protects — with the SAME permissions, since a copy of
 *  a 600 file left readable by everyone leaks exactly what the 600 protected. */
export function backup(file: string): string | null {
  const cible = cheminReel(file);
  try {
    const cur = fs.readFileSync(cible, "utf8");
    if (!cur.trim()) return null;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const bak = `${cible}.bak-${ts}`;
    const droits = droitsExistants(cible);
    fs.writeFileSync(bak, cur, droits === null ? "utf8" : { encoding: "utf8", mode: droits });
    return bak;
  } catch {
    return null; // no prior file → nothing to back up
  }
}

/** Atomic write that first backs up any existing content. Returns the backup path. */
export function atomicWriteWithBackup(file: string, content: string): string | null {
  const bak = backup(file);
  atomicWrite(file, content);
  return bak;
}
