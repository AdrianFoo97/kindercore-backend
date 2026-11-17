import { describe, it, expect } from 'vitest';
import { certifyProblem, trainedOnProblem } from '../../services/sopTraining.logic.js';

// Teacher app → My training: the day a trainer says they gave the training.

describe('Recording training given', () => {
  it('accepts today or an earlier day, and refuses a future or made-up one', () => {
    expect(trainedOnProblem('2026-11-17', '2026-11-17')).toBeNull();
    expect(trainedOnProblem('2026-10-01', '2026-11-17')).toBeNull();
    expect(trainedOnProblem('2026-11-18', '2026-11-17')).toMatch(/future/);
    expect(trainedOnProblem('17/11/2026', '2026-11-17')).toMatch(/Pick the day/);
  });

  it('certifies only when nothing failed and at least one step passed', () => {
    expect(certifyProblem(['PASS', 'NA', 'PASS'])).toBeNull();
    expect(certifyProblem(['PASS', 'FAIL'])).toMatch(/send it back/);
    expect(certifyProblem(['NA', 'NA'])).toMatch(/at least one step passed/);
  });
});
