export const MIN_NOTES = 50;
export const MAX_NOTES = 30000;

export function notesReady(notes) {
  return notes.trim().length >= MIN_NOTES;
}