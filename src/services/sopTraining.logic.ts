// Teacher app → My training: the trainer records that they gave the training.

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** What's wrong with the day the training was given (YYYY-MM-DD), compared with today in Malaysia — or null. */
export function trainedOnProblem(trainedOn: string, today: string): string | null {
  if (!DAY_PATTERN.test(trainedOn) || Number.isNaN(Date.parse(`${trainedOn}T00:00:00Z`))) return 'Pick the day the training was given.';
  if (trainedOn > today) return 'The training day can’t be in the future.';
  return null;
}

export type StepMark = 'PASS' | 'FAIL' | 'NA';

/**
 * Why the assessor can't certify yet — or null. Certified means every step they
 * checked was done right: a failed step goes back for more training instead, and
 * all N/A means nothing was actually assessed.
 */
export function certifyProblem(marks: StepMark[]): string | null {
  if (marks.some(m => m === 'FAIL')) return 'A step failed — send it back for more training instead of certifying.';
  if (!marks.some(m => m === 'PASS')) return 'Mark at least one step passed before certifying.';
  return null;
}
