import { describe, it, expect } from 'vitest';
import { inferRelations, SchemaTableShape } from '../../controllers/db-schema.controller.js';

// The naming rules the Database Design page uses to draw links between
// tables that have no declared foreign key. Pure logic — no database.

const t = (name: string, columns: string[], primaryKey = ['id']): SchemaTableShape => ({ name, columns, primaryKey });

const TABLES = [
  t('Teacher', ['id', 'name', 'positionId']),
  t('Position', ['positionId', 'title', 'departmentId'], ['positionId']),
  t('Department', ['departmentId', 'name'], ['departmentId']),
  t('User', ['id', 'teacherId']),
  t('BugReport', ['id', 'reportedByUserId']),
  t('SopCategory', ['id']),
  t('OperatingCostCategory', ['id', 'groupId']),
  t('OperatingCostCategoryGroup', ['id']),
  t('OperatingCost', ['id', 'categoryId']),
  t('Lead', ['id', 'googleEventId']),
  t('TeacherRewardGoal', ['teacherId', 'rewardId'], ['teacherId']),
  t('PointsRewardItem', ['id']),
];

const linkOf = (from: string, col: string) => inferRelations(TABLES, []).find(r => `${r.fromTable}.${r.fromColumn}` === `${from}.${col}`);

describe('Database Design — inferring links between tables', () => {
  it('links an xxxId column to the table named Xxx', () => {
    expect(linkOf('User', 'teacherId')).toMatchObject({ toTable: 'Teacher', toColumn: 'id', kind: 'inferred' });
  });

  it('points at the target table\'s real key column, not always "id"', () => {
    expect(linkOf('Teacher', 'positionId')).toMatchObject({ toTable: 'Position', toColumn: 'positionId' });
  });

  it('finds the table from the last words of a longer name', () => {
    expect(linkOf('BugReport', 'reportedByUserId')).toMatchObject({ toTable: 'User' });
  });

  it('picks the matching table that shares the longest name prefix with the owner', () => {
    expect(linkOf('OperatingCost', 'categoryId')?.toTable).toBe('OperatingCostCategory');
    expect(linkOf('OperatingCostCategory', 'groupId')?.toTable).toBe('OperatingCostCategoryGroup');
  });

  it('does not treat a table\'s own key named after itself as a link', () => {
    expect(linkOf('Department', 'departmentId')).toBeUndefined();
    expect(linkOf('Position', 'positionId')).toBeUndefined();
  });

  it('still links a primary key that points at a different table', () => {
    expect(linkOf('TeacherRewardGoal', 'teacherId')).toMatchObject({ toTable: 'Teacher' });
  });

  it('uses the known-links list for columns whose name does not say where they point', () => {
    expect(linkOf('TeacherRewardGoal', 'rewardId')).toMatchObject({ toTable: 'PointsRewardItem' });
  });

  it('leaves ids from outside systems unlinked', () => {
    expect(linkOf('Lead', 'googleEventId')).toBeUndefined();
  });

  it('does not duplicate a link that a real foreign key already covers', () => {
    const rels = inferRelations(TABLES, [{ fromTable: 'User', fromColumn: 'teacherId' }]);
    expect(rels.find(r => r.fromTable === 'User' && r.fromColumn === 'teacherId')).toBeUndefined();
  });
});
