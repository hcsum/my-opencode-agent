---
name: google-drive-backup
description: Back up the whole `notes/` directory to Google Drive using local OAuth credentials. Creates a timestamped version folder under a target Drive folder.
---

# Google Drive Notes Backup

Use this skill when the user wants to back up the local `notes/` directory to Google Drive.

## What it backs up

- Default source: `notes/`
- Default behavior: upload the entire directory tree
- Default destination: a new timestamped folder inside a target Google Drive folder

## What it does not back up

- `.env`
- `.git/`
- `node_modules/`
- `dist/`
- anything outside `notes/`

## OAuth setup

This skill uses local OAuth files in `~/.gdrive-backup/`:

- `gcp-oauth.keys.json`
- `credentials.json`

If `credentials.json` does not exist yet, first put your Google OAuth client JSON at `~/.gdrive-backup/gcp-oauth.keys.json`, then run:

```bash
npx tsx .opencode/skills/google-drive-backup/scripts/auth.ts
```

The script starts a temporary localhost callback server, opens the Google consent flow URL, and saves tokens to `~/.gdrive-backup/credentials.json`.

## Backup command

Preferred: set `GDRIVE_NOTES_BACKUP_FOLDER_ID` in your shell or `.env`, then run:

```bash
printf '%s' '{}' | npx tsx .opencode/skills/google-drive-backup/scripts/backup.ts
```

Or pass the target folder explicitly:

```bash
printf '%s' '{"folderId":"<google-drive-folder-id>"}' | npx tsx .opencode/skills/google-drive-backup/scripts/backup.ts
```

Optional fields:

```json
{
  "folderId": "<google-drive-folder-id>",
  "sourceDir": "notes",
  "versionLabel": "manual-backup"
}
```

## Output

The script prints JSON with:

- `folderId`: the created version folder ID
- `folderName`: the created version folder name
- `fileCount`: uploaded file count
- `files`: uploaded relative paths and file IDs

## Failure rules

- If OAuth files are missing or invalid, stop and tell the user to fix local Google Drive auth first.
- If the target Drive folder ID is missing, stop and ask for it or tell the user to set `GDRIVE_NOTES_BACKUP_FOLDER_ID`.
- Do not silently fall back to any other backup destination.
